from datasette.app import Datasette
import pytest


@pytest.mark.asyncio
async def test_static_asset_sticky_footer():
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    response = await datasette.client.get(
        "/-/static-plugins/datasette_app_support/sticky-footer.css"
    )
    assert response.status_code == 200
