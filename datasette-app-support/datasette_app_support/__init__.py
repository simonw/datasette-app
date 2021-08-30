from datasette import hookimpl


@hookimpl
def extra_css_urls(datasette):
    return [
        datasette.urls.static_plugins("datasette_app_support", "sticky-footer.css")
    ]
