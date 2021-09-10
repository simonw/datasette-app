#!/bin/bash
release_date="20210724"
filename="cpython-3.9.6-x86_64-apple-darwin-install_only-20210724T1424.tar.gz"

standalone_python="python/"

if [ ! -d "$standalone_python" ]; then
    wget https://github.com/indygreg/python-build-standalone/releases/download/${release_date}/${filename}
    tar -xzvf ${filename}                                                                          
    rm -rf ${filename}
    # Now delete the test/ folder, saving about 23MB of disk space
    rm -rf python/lib/python3.9/test
fi