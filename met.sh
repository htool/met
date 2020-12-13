#!/bin/bash

cd $HOME/src/met/public

for forecast in `wget -qO - "https://www.metoffice.gov.uk/weather/maps-and-charts/surface-pressure" |grep "/SurfacePressureChart/"| awk -F\" '{print $2}'`
do
  file=`basename $forecast`".gif"
  wget -O $file $forecast
done

