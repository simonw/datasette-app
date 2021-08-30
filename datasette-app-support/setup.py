from setuptools import setup
import os

VERSION = "0.1"


def get_long_description():
    with open(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "README.md"),
        encoding="utf8",
    ) as fp:
        return fp.read()


setup(
    name="datasette-app-support",
    description="Part of datasette.app",
    long_description=get_long_description(),
    long_description_content_type="text/markdown",
    author="Simon Willison",
    url="https://github.com/simonw/datasette.app",
    license="Apache License, Version 2.0",
    version=VERSION,
    packages=["datasette_app_support"],
    entry_points={"datasette": ["app_support = datasette_app_support"]},
    install_requires=["datasette>=0.59a2"],
    extras_require={"test": ["pytest", "pytest-asyncio"]},
    tests_require=["datasette-app-support[test]"],
    package_data={
        "datasette_app_support": ["static/*", "templates/*"]
    },
    python_requires=">=3.6",
)
