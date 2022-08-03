#!/bin/bash
release_date="20220802"
filename="cpython-3.10.6+20220802-x86_64-apple-darwin-install_only.tar.gz"

standalone_python="python/"

if [ ! -d "$standalone_python" ]; then
    wget https://github.com/indygreg/python-build-standalone/releases/download/${release_date}/${filename}
    tar -xzvf ${filename}                                                                          
    rm -rf ${filename}
    # Now delete the test/ folder, saving about 23MB of disk space
    rm -rf python/lib/python3.10/test
fi
