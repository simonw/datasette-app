# datasette-app

An Electron app that wraps [Datasette](https://datasette.io/). See [Building a desktop application for Datasette](https://simonwillison.net/2021/Aug/30/datasette-app/) for background on this project.

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
