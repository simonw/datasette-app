# Datasette Desktop

A macOS desktop application that wraps [Datasette](https://datasette.io/). See [Building a desktop application for Datasette](https://simonwillison.net/2021/Aug/30/datasette-app/) for background on this project.

## Installation

Grab the latest release from [the releases page](https://github.com/simonw/datasette-app/releases). Download `Datasette.app.zip`, uncompress it and drag `Datasette.app` to your `/Applications` folder - then double-click the icon.

The first time you launch the app it will install the latest version of Datasette, which could take a little while. Subsequent application launches will be a lot quicker.

## Application features

- Includes a full copy of Python which stays separate from any other Python versions you may have installed
- Installs the latest Datasette release the first time it runs
- The application can open existing SQLite database files or read CSV files into an in-memory database
- It can also create a new, empty SQLite database file and create tables in that database by importing CSV data
- By default the server only accepts connections from your computer, but you can use "File -> Access Control -> Anyone on my networks" to make it visible to other computers on your network (or devices on your [Tailscale](https://tailscale.com/) network).
- Datasette plugins can be installed using the "Install Plugin" menu item

## How it works

The app consists of two parts: the Electron app, and a custom Datasette plugin called [datasette-app-support](https://github.com/simonw/datasette-app-support).

It is not yet packaged with an installer. You can preview the app like so:

    # Clone the repo
    git clone https://github.com/simonw/datasette-app
    cd datasette-app
    
    # Download standalone Python
    ./download-python.sh
    
    # Install Electron dependencies and start it running:
    npm install
    npm start

When the app first starts up it will create a Python virtual environment in `~/.datasette-app/venv` and install both Datasette and the `datasette-app-support` plugin into that environment.

To run the Electron tests:

    npm test

The Electron tests may leave a `datasette` process running. You can find the process ID for this using:

    ps aux | grep xyz

Then use `kill PROCESS_ID` to terminate it.

![datasette-app](https://user-images.githubusercontent.com/9599/131289203-18186b26-49a4-46e9-8925-b9e4745f3252.png)
