from datasette.database import Database
from datasette.utils.asgi import Response, Forbidden
from datasette.utils import sqlite3
from datasette import hookimpl
from dateutil import parser
from packaging import version
from sqlite_utils.utils import rows_from_file
import httpx
import json
import os
import pathlib
import secrets
import sqlite_utils
from .utils import derive_table_name, import_csv_url_to_database


@hookimpl
def startup(datasette):
    async def inner():
        if getattr(datasette, "_app_support_initialized", False):
            return
        datasette._app_support_initialized = True
        try:
            plugins = httpx.get(
                "https://datasette.io/content/plugins.json?_shape=array&_size=max",
                follow_redirects=True,
            ).json()
            if not isinstance(plugins, list):
                plugins = []
        except Exception:
            # Never let a blocked/slow/failed network fetch break app startup -
            # the Electron shell waits forever for "Uvicorn running" otherwise.
            plugins = []
        # Annotate with list of installed plugins. Datasette 1.0 changed
        # /-/plugins.json from a bare array to {"ok": true, "plugins": [...]},
        # so accept both shapes.
        plugins_json = (await datasette.client.get("/-/plugins.json")).json()
        if isinstance(plugins_json, dict):
            plugins_json = plugins_json.get("plugins", [])
        installed_plugins = {
            plugin["name"]: plugin["version"] for plugin in plugins_json
        }
        default_plugins = (os.environ.get("DATASETTE_DEFAULT_PLUGINS") or "").split()
        for plugin in plugins:
            is_installed = plugin["name"] in installed_plugins
            installed_version = installed_plugins.get(plugin["name"])
            plugin["installed"] = "installed" if is_installed else "not installed"
            plugin["installed_version"] = installed_version
            plugin["upgrade"] = (
                "upgrade available"
                if (
                    is_installed
                    and installed_version
                    and (
                        version.parse(installed_version)
                        < version.parse(plugin.get("tag_name", ""))
                    )
                )
                else None
            )
            plugin["is_default"] = plugin["name"] in default_plugins
        try:
            datasette.remove_database("_memory")
        except KeyError:
            pass
        datasette.add_memory_database("temporary")
        plugin_directory_db = datasette.add_memory_database("plugin_directory")

        # Datasette 1.0's permission system reads its list of viewable
        # databases from an internal "catalog_databases" table, which is
        # snapshotted from `datasette.databases` once during Datasette's own
        # startup (before plugin startup hooks run) and then only resynced
        # lazily (throttled to ~once/second) on subsequent requests. Since we
        # just mutated `datasette.databases` above (removing "_memory", adding
        # "temporary"/"plugin_directory"), that snapshot is now stale: it
        # still lists "_memory" as viewable, which crashes
        # `datasette/views/index.py` with `KeyError: '_memory'` when it does
        # `self.ds.databases[name]` for a database that no longer exists. Force
        # an immediate resync here so the catalog matches reality before the
        # first request (e.g. the homepage) can observe the stale state.
        await datasette.refresh_schemas(force=True)

        def write_plugins(conn):
            db = sqlite_utils.Database(conn)
            for table in ("plugins", "plugins_fts"):
                db[table].drop(ignore=True)
            if plugins:
                db["plugins"].insert_all(plugins, pk="full_name")
                db["plugins"].enable_fts(["full_name", "name", "description"])
            else:
                # Create an empty table
                db["plugins"].create(
                    {
                        "name": str,
                        "full_name": str,
                        "owner": str,
                        "description": str,
                        "stargazers_count": int,
                        "tag_name": str,
                        "latest_release_at": str,
                        "created_at": str,
                        "openGraphImageUrl": str,
                        "usesCustomOpenGraphImage": int,
                        "downloads_this_week": int,
                        "is_plugin": int,
                        "is_tool": int,
                        "installed": str,
                        "installed_version": str,
                        "upgrade": str,
                        "is_default": int,
                    }
                )

        await plugin_directory_db.execute_write_fn(write_plugins, block=True)

    return inner


# Note: the `permission_allowed` plugin hook was removed in Datasette 1.0a20.
# It previously blocked "view-database" on `_internal` even for the root actor.
# In Datasette 1.0 the internal database is no longer listed in
# `datasette.databases` by default, so that block is no longer needed.


@hookimpl
def extra_css_urls(datasette):
    return [datasette.urls.static_plugins("datasette_app_support", "sticky-footer.css")]


def error(message, status=400):
    return Response.json({"ok": False, "error": message}, status=status)


unauthorized = error("Not authorized", status=401)


def check_auth(request):
    env_token = os.environ.get("DATASETTE_API_TOKEN")
    request_token = request.headers.get("authorization", "").replace("Bearer ", "")
    if not env_token or not request_token:
        return False
    return secrets.compare_digest(
        request_token,
        env_token,
    )


async def open_database_file(request, datasette):
    if not check_auth(request):
        return unauthorized
    try:
        filepath = await _filepath_from_json_body(request)
    except PathError as e:
        return error(e.message)
    # Confirm it's a valid SQLite database
    conn = sqlite3.connect(filepath)
    try:
        conn.execute("select * from sqlite_master")
    except sqlite3.DatabaseError:
        return error("Not a valid SQLite database")
    # Is that file already open?
    existing_paths = {
        pathlib.Path(db.path).resolve()
        for db in datasette.databases.values()
        if db.path
    }
    if pathlib.Path(filepath).resolve() in existing_paths:
        return error("That file is already open")
    added_db = datasette.add_database(
        Database(datasette, path=filepath, is_mutable=True)
    )
    return Response.json({"ok": True, "path": datasette.urls.database(added_db.name)})


async def new_empty_database_file(request, datasette):
    if not check_auth(request):
        return unauthorized
    try:
        filepath = await _filepath_from_json_body(request, must_exist=False)
    except PathError as e:
        return error(e.message)
    # File should not exist yet
    if os.path.exists(filepath):
        return error("That file already exists")

    conn = sqlite3.connect(filepath)
    conn.execute("vacuum")

    added_db = datasette.add_database(
        Database(datasette, path=filepath, is_mutable=True)
    )
    return Response.json({"ok": True, "path": datasette.urls.database(added_db.name)})


class PathError(Exception):
    def __init__(self, message):
        self.message = message


async def _filepath_from_json_body(request, must_exist=True, return_data=False):
    body = await request.post_body()
    try:
        data = json.loads(body)
    except ValueError:
        raise PathError("Invalid request body, should be JSON")
    filepath = data.get("path")
    if not filepath:
        raise PathError("'path' key is required'")
    if must_exist and not os.path.exists(filepath):
        raise PathError("'path' does not exist")
    if return_data:
        return filepath, data
    else:
        return filepath


async def open_csv_file(request, datasette):
    return await _import_csv_file(request, datasette, database="temporary")


async def open_csv_from_url(request, datasette):
    body = await request.post_body()
    try:
        data = json.loads(body)
    except ValueError:
        return error("Invalid request body, should be JSON")
    url = data.get("url")
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        return error("URL must start with http:// or https://")
    database = data.get("database") or "temporary"
    if database and (database not in datasette.databases):
        return error("Invalid database")
    db = datasette.get_database(database)
    requested_table_name = data.get("table_name")
    try:
        table_name, num_rows = await import_csv_url_to_database(
            url, db, requested_table_name
        )
    except Exception as e:
        return error(str(e), status=500)
    return Response.json(
        {
            "ok": True,
            "path": datasette.urls.table(db.name, table_name),
            "rows": num_rows,
        }
    )


async def import_csv_file(request, datasette):
    return await _import_csv_file(request, datasette)


async def _import_csv_file(request, datasette, database=None):
    if not check_auth(request):
        return unauthorized
    try:
        filepath, body = await _filepath_from_json_body(request, return_data=True)
    except PathError as e:
        return error(e.message)

    if database is None:
        database = body.get("database")
    if not database or database not in datasette.databases:
        return error("Invalid database")

    db = datasette.get_database(database)

    table_name = await derive_table_name(db, pathlib.Path(filepath).stem)

    try:
        rows = rows_from_file(open(filepath, "rb"))[0]

        def write_rows(conn):
            dbconn = sqlite_utils.Database(conn)
            dbconn[table_name].insert_all(rows)
            return dbconn[table_name].count

        num_rows = await db.execute_write_fn(write_rows, block=True)
        return Response.json(
            {
                "ok": True,
                "path": datasette.urls.table(database, table_name),
                "rows": num_rows,
            }
        )
    except Exception as e:
        return error(str(e), status=500)


async def auth_app_user(request, datasette):
    if not check_auth(request):
        return unauthorized
    body = await request.post_body()
    try:
        data = json.loads(body)
    except ValueError:
        data = {}
    redirect = data.get("redirect") or "/"
    response = Response.redirect(redirect)
    response.set_cookie("ds_actor", datasette.sign({"a": {"id": "root"}}, "actor"))
    return response


async def dump_temporary_to_file(request, datasette):
    if not check_auth(request):
        return unauthorized
    try:
        filepath = await _filepath_from_json_body(request, must_exist=False)
    except PathError as e:
        return error(e.message)
    db = datasette.get_database("temporary")

    def backup(conn):
        conn.isolation_level = None
        conn.execute("vacuum into '{}'".format(filepath))
        conn.isolation_level = ""

    await db.execute_write_fn(backup, block=True)
    return Response.json({"ok": True, "path": filepath})


async def restore_temporary_from_file(request, datasette):
    if not check_auth(request):
        return unauthorized
    try:
        filepath = await _filepath_from_json_body(request)
    except PathError as e:
        return error(e.message)
    temporary = datasette.get_database("temporary")
    backup_db = sqlite3.connect(filepath, uri=True)
    temporary_conn = temporary.connect(write=True)
    backup_db.backup(temporary_conn)
    backup_tables = [
        r[0]
        for r in backup_db.execute(
            "select name from sqlite_master where type='table'"
        ).fetchall()
    ]
    temporary_conn.close()
    backup_db.close()
    return Response.json(
        {
            "ok": True,
            "path": filepath,
            "restored_tables": await temporary.table_names(),
            "backup_tables": backup_tables,
        }
    )


@hookimpl
def register_routes():
    return [
        (r"^/-/open-database-file$", open_database_file),
        (r"^/-/new-empty-database-file$", new_empty_database_file),
        (r"^/-/open-csv-file$", open_csv_file),
        (r"^/-/open-csv-from-url$", open_csv_from_url),
        (r"^/-/import-csv-file$", import_csv_file),
        (r"^/-/auth-app-user$", auth_app_user),
        (r"^/-/dump-temporary-to-file$", dump_temporary_to_file),
        (r"^/-/restore-temporary-from-file$", restore_temporary_from_file),
    ]


def suffix(d):
    return "th" if 11 <= d <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(d % 10, "th")


def prettydate(date):
    if isinstance(date, str):
        try:
            date = parser.parse(date)
        except parser.ParserError:
            return date
    return "{day}{suffix} {month} {year}".format(
        day=date.day,
        month=date.strftime("%B"),
        suffix=suffix(date.day),
        year=date.year,
    )


@hookimpl
def extra_template_vars(datasette):
    async def inner():
        return {
            "prettydate": prettydate,
            "total_plugin_count": (
                await datasette.get_database("plugin_directory").execute(
                    "select count(*) from plugins"
                )
            ).single_value(),
        }

    return inner
