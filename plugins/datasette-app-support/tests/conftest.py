from unittest import mock
import os
import pytest


@pytest.fixture(autouse=True)
def mock_settings_env_vars():
    with mock.patch.dict(os.environ, {"DATASETTE_API_TOKEN": "fake-token"}):
        yield


@pytest.fixture(autouse=True)
def mock_datasette_plugin_api(httpx_mock):
    httpx_mock.add_response(
        url="https://datasette.io/content/plugins.json?_shape=array&_size=max",
        json=[
            {
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
            }
        ],
    )


@pytest.fixture
def non_mocked_hosts():
    return ["localhost"]
