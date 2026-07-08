from datasette.app import Datasette
import pytest
import sqlite3


@pytest.mark.asyncio
async def test_open_csv_files(tmpdir):
    datasette = Datasette([], memory=True, pdb=True)
    await datasette.invoke_startup()
    path = str(tmpdir / "demo.csv")
    open(path, "w").write("id,name\n123,Hello")
    response = await datasette.client.post(
        "/-/open-csv-file",
        json={"path": path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": "/temporary/demo", "rows": 1}
    response2 = await datasette.client.get("/temporary/demo.json?_shape=array")
    assert response2.json() == [{"rowid": 1, "id": "123", "name": "Hello"}]


@pytest.mark.asyncio
async def test_open_csv_files_invalid_csv(tmpdir):
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    path = str(tmpdir / "bad.csv")
    open(path, "wb").write(
        b"date,name,latitude,longitude\n" b"2020-03-04,S\xe3o Paulo,-23.561,-46.645\n"
    )
    response = await datasette.client.post(
        "/-/open-csv-file",
        json={"path": path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 500
    assert response.json() == {
        "ok": False,
        "error": "'utf-8' codec can't decode byte 0xe3 in position 41: invalid continuation byte",
    }


@pytest.mark.asyncio
async def test_import_csv_files(tmpdir):
    db_path = str(tmpdir / "data.db")
    sqlite3.connect(db_path).execute("vacuum")
    datasette = Datasette([db_path], memory=True, pdb=True)
    await datasette.invoke_startup()
    path = str(tmpdir / "demo.csv")
    open(path, "w").write("id,name\n123,Hello")
    response = await datasette.client.post(
        "/-/import-csv-file",
        json={"path": path, "database": "data"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": "/data/demo", "rows": 1}
    response2 = await datasette.client.get("/data/demo.json?_shape=array")
    assert response2.json() == [{"rowid": 1, "id": "123", "name": "Hello"}]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "should_redirect,table_name,expected_table_name",
    (
        (False, None, "test"),
        (True, None, "test-redirect"),
        (False, "creatures", "creatures"),
        (True, "creatures", "creatures"),
    ),
)
async def test_import_csv_url(
    httpx_mock, should_redirect, table_name, expected_table_name
):
    url = "http://example.com/test.csv"
    if should_redirect:
        httpx_mock.add_response(
            url="http://example.com/test-redirect",
            status_code=302,
            headers={"Location": "/test.csv"},
        )
        url = "http://example.com/test-redirect"
    httpx_mock.add_response(
        url="http://example.com/test.csv", text="id,name\n1,Banyan\n2,Crystal"
    )
    datasette = Datasette([], memory=True)
    # Reset temporary database, if populated
    await datasette.invoke_startup()
    await _reset_temporary(datasette)
    response = await datasette.client.post(
        "/-/open-csv-from-url",
        json={"url": url, "table_name": table_name},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "path": "/temporary/{}".format(expected_table_name),
        "rows": 2,
    }
    response2 = await datasette.client.get(
        "/temporary/{}.json?_shape=array".format(expected_table_name)
    )
    assert response2.json() == [
        {"rowid": 1, "id": "1", "name": "Banyan"},
        {"rowid": 2, "id": "2", "name": "Crystal"},
    ]


async def _reset_temporary(datasette):
    if "temporary" not in datasette.databases:
        return
    db = datasette.get_database("temporary")
    for table in await db.table_names():
        await db.execute_write("drop table [{}]".format(table))
