from datasette.database import Database
from datasette.utils.asgi import Response
from datasette.utils import sqlite3
from datasette import hookimpl
import json
import os
import pathlib


@hookimpl
def extra_css_urls(datasette):
    return [datasette.urls.static_plugins("datasette_app_support", "sticky-footer.css")]


async def open_database_file(request, datasette):
    body = await request.post_body()
    try:
        data = json.loads(body)
    except ValueError:
        return Response.json(
            {"ok": False, "error": "Invalid request body, should be JSON"}, status=400
        )
    filepath = data.get("path")
    if not filepath:
        return Response.json(
            {"ok": False, "error": "'path' key is required'"}, status=400
        )
    if not os.path.exists(filepath):
        return Response.json(
            {"ok": False, "error": "'path' does not exist"}, status=400
        )
    # Confirm it's a valid SQLite database
    conn = sqlite3.connect(filepath)
    try:
        conn.execute("select * from sqlite_master")
    except sqlite3.DatabaseError:
        return Response.json(
            {"ok": False, "error": "Not a valid SQLite database"}, status=400
        )
    # Is that file already open?
    existing_paths = {
        pathlib.Path(db.path).resolve()
        for db in datasette.databases.values()
        if db.path
    }
    if pathlib.Path(filepath).resolve() in existing_paths:
        return Response.json(
            {"ok": False, "error": "That file is already open"}, status=400
        )
    datasette.add_database(Database(datasette, path=filepath, is_mutable=True))
    return Response.json({"ok": True})


@hookimpl
def register_routes():
    return [(r"^/-/open-database-file$", open_database_file)]
