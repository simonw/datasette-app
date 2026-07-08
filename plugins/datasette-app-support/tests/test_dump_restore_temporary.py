from datasette.app import Datasette
from datasette.utils import sqlite3
import pytest


@pytest.mark.asyncio
async def test_dump_temporary_to_file(tmpdir):
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    # Import CSV into temporary
    path = str(tmpdir / "backup_demo.csv")
    backup_path = str(tmpdir / "backup.db")
    open(path, "w").write("id,name\n123,Hello")
    response = await datasette.client.post(
        "/-/open-csv-file",
        json={"path": path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    # Dump temporary to a file
    response = await datasette.client.post(
        "/-/dump-temporary-to-file",
        json={"path": backup_path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": backup_path}
    # Check that the backup file has the right stuff
    conn = sqlite3.connect(backup_path)
    assert conn.execute("select * from backup_demo").fetchall() == [("123", "Hello")]


@pytest.mark.asyncio
async def test_restore_temporary_from_file(tmpdir):
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    # Populate backup database
    backup_path = str(tmpdir / "backup.db")
    conn = sqlite3.connect(backup_path)
    conn.execute("create table backup_restored (id integer primary key)")
    conn.execute("insert into backup_restored (id) values (1)")
    conn.execute("insert into backup_restored (id) values (2)")
    conn.execute("insert into backup_restored (id) values (3)")
    conn.close()
    response = await datasette.client.get("/temporary/backup_restored")
    assert response.status_code == 404
    # Restore it
    response = await datasette.client.post(
        "/-/restore-temporary-from-file",
        json={"path": backup_path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "path": backup_path,
        "restored_tables": ["backup_restored"],
        "backup_tables": ["backup_restored"],
    }
    # Check the restore
    response2 = await datasette.client.get("/temporary/backup_restored")
    assert response2.status_code == 200
