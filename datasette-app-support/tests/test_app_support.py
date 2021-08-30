from datasette.app import Datasette
import pytest


@pytest.mark.asyncio
async def test_plugin_is_installed():
    datasette = Datasette([], memory=True)
    response = await datasette.client.get("/-/plugins.json")
    assert response.status_code == 200
    installed_plugins = {p["name"] for p in response.json()}
    assert "datasette-app-support" in installed_plugins


@pytest.mark.asyncio
async def test_static_asset_sticky_footer():
    datasette = Datasette([], memory=True)
    response = await datasette.client.get("/-/static-plugins/datasette_app_support/sticky-footer.css")
    assert response.status_code == 200
