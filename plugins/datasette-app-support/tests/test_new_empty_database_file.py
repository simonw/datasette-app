from datasette.app import Datasette
import pytest


@pytest.mark.asyncio
async def test_new_empty_database_file(tmpdir):
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    path = str(tmpdir / "new.db")
    response = await datasette.client.post(
        "/-/new-empty-database-file",
        json={"path": path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "path": "/new"}
    response = await datasette.client.get("/new.json")
    assert (
        response.json().items()
        >= {"database": "new", "path": "/new", "tables": []}.items()
    )
    # Attempting to create the same file again throws an error
    response2 = await datasette.client.post(
        "/-/new-empty-database-file",
        json={"path": path},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response2.status_code == 400
    assert response2.json() == {"error": "That file already exists", "ok": False}
