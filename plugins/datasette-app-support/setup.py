from setuptools import setup
import os

VERSION = "0.12.0"


def get_long_description():
    with open(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "README.md"),
        encoding="utf8",
    ) as fp:
        return fp.read()


setup(
    name="datasette-app-support",
    description="Part of https://github.com/simonw/datasette-app",
    long_description=get_long_description(),
    long_description_content_type="text/markdown",
    author="Simon Willison",
    url="https://github.com/simonw/datasette-app-support",
    project_urls={
        "Issues": "https://github.com/simonw/datasette-app-support/issues",
        "CI": "https://github.com/simonw/datasette-app-support/actions",
        "Changelog": "https://github.com/simonw/datasette-app-support/releases",
    },
    license="Apache License, Version 2.0",
    version=VERSION,
    packages=["datasette_app_support"],
    package_data={
        "datasette_app_support": [
            "static/*.js",
            "static/*.css",
            "templates/*.html",
        ],
    },
    entry_points={"datasette": ["app_support = datasette_app_support"]},
    install_requires=[
        "datasette>=1.0a36",
        "sqlite-utils>=4.0",
        "packaging",
        "python-dateutil",
        "httpx",
    ],
    extras_require={"test": ["pytest", "pytest-asyncio", "black", "pytest-httpx"]},
    tests_require=["datasette-app-support[test]"],
    python_requires=">=3.10",
)
