from datasette.app import Datasette
import httpx
import pytest


@pytest.mark.asyncio
async def test_plugin_directory():
    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    plugins = (
        await datasette.get_database("plugin_directory").execute(
            "select * from plugins"
        )
    ).rows
    assert len(plugins) == 1
    assert dict(plugins[0]) == {
        "name": "datasette-write",
        "full_name": "simonw/datasette-write",
        "owner": "simonw",
        "description": "Datasette plugin providing a UI for executing SQL writes against the database",
        "stargazers_count": 3,
        "tag_name": "0.2",
        "latest_release_at": "2021-09-11T05:59:43Z",
        "created_at": "2020-06-29T02:27:31Z",
        "openGraphImageUrl": "https://avatars.githubusercontent.com/u/9599?s=400&v=4",
        "usesCustomOpenGraphImage": 0,
        "downloads_this_week": 163,
        "is_plugin": 1,
        "is_tool": 0,
        "installed": "not installed",
        "installed_version": None,
        "upgrade": None,
        "is_default": 0,
    }
    response = await datasette.client.get("/plugin_directory/plugins")
    assert "<h2>datasette-write</h2>" in response.text
    assert (
        "<p><strong>Latest release:</strong> 0.2 on 11th September 2021</p>"
        in response.text
    )
    assert '<label for="_search">Search:</label>' in response.text


@pytest.mark.asyncio
async def test_plugin_directory_no_connection(httpx_mock):
    httpx_mock.reset(False)

    def raise_timeout(request):
        raise httpx.NetworkError("No internet connection", request=request)

    httpx_mock.add_callback(raise_timeout)

    datasette = Datasette([], memory=True)
    await datasette.invoke_startup()
    response = await datasette.client.get("/plugin_directory/plugins")
    assert "<strong>Could not access plugins</strong>" in response.text
    assert '<label for="_search">Search:</label>' not in response.text
