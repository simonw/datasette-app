from datasette.app import Datasette
import pytest


@pytest.mark.asyncio
async def test_auth_app_user():
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    response = await datasette.client.post(
        "/-/auth-app-user",
        json={"redirect": "/-/metadata"},
        headers={"Authorization": "Bearer fake-token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/-/metadata"
    assert response.headers["set-cookie"].startswith("ds_actor=")
    assert datasette.unsign(response.cookies["ds_actor"], "actor") == {
        "a": {"id": "root"}
    }
    # With a bad token
    response2 = await datasette.client.post(
        "/-/auth-app-user",
        json={"redirect": "/-/metadata"},
        headers={"Authorization": "Bearer bad-token"},
    )
    assert response2.status_code == 401
