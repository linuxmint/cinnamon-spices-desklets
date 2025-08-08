#!/bin/bash
FILE=$1
sleep 1
RES=$(file ${FILE:7} | grep -Eo ", [[:digit:]]+ *x *[[:digit:]]+" | tr "," " ")

echo -n $RES

exit 0
