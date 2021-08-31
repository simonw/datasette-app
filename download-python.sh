#!/bin/bash

wget https://github.com/indygreg/python-build-standalone/releases/download/20210724/cpython-3.9.6-x86_64-apple-darwin-install_only-20210724T1424.tar.gz
tar -xzvf cpython-3.9.6-x86_64-apple-darwin-install_only-20210724T1424.tar.gz                                                                          
# Now delete the test/ folder, saving about 23MB of disk space
rm -rf python/lib/python3.9/test
