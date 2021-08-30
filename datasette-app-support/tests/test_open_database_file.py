from datasette.app import Datasette
import pytest
import sqlite3


@pytest.mark.asyncio
async def test_open_database_files(tmpdir):
    datasette = Datasette([], memory=True)
    path = str(tmpdir / "test.db")
    db = sqlite3.connect(path)
    db.execute("create table foo (id integer primary key)")
    response = await datasette.client.post("/-/open-database-file", json={"path": path})
    assert response.status_code == 200
    assert response.json()["ok"] is True
    response = await datasette.client.get("/test.json")
    assert (
        response.json()["tables"][0].items()
        >= {"name": "foo", "columns": ["id"], "primary_keys": ["id"]}.items()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("file", ("does-not-exist.txt", "invalid.txt"))
async def test_open_database_files_invalid(file, tmpdir):
    datasette = Datasette([], memory=True)
    if file == "does-not-exist.txt":
        path = str(tmpdir / "does-not-exists.txt")
    elif file == "invalid.txt":
        path = str(tmpdir / "invalid.txt")
        open(path, "w").write("invalid")
    else:
        assert False
    response = await datasette.client.post("/-/open-database-file", json={"path": path})
    assert response.status_code == 400
    assert response.json()["ok"] is False
