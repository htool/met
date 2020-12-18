// Copyright (c) 2016 Rafał Pocztarski
// Released under MIT License (Expat) - see:
// https://github.com/rsp/node-static-http-servers/blob/master/LICENSE.md

var path = require('path');
var express = require('express');
var schedule = require('node-schedule');
var http = require('https');
var app = express();
var request = require('request');
var cheerio = require('cheerio');
var charts = {};
const chartsFolder = path.join(__dirname, 'public');
const chartsJson = path.join(chartsFolder, 'charts.json');
const fs = require('fs');


function saveInfo () {
  console.log('Saving ' + Object.keys(charts).length)
  fs.writeFileSync(chartsJson, JSON.stringify(charts), (err) => {
    if (err) throw err;
  });
}

function loadInfo () {
  if (fs.existsSync(chartsJson)) {
    charts = JSON.parse(fs.readFileSync(chartsJson, 'utf8'));
    // console.log('Loaded charts: ' + JSON.stringify(charts));
  }
  removeOld();
}

const download = (url, dest, cb) => {
    const file = fs.createWriteStream(dest);
    const sendReq = request.get(url);

    // verify response code
    sendReq.on('response', (response) => {
        // console.log('Download response: ' + JSON.stringify(response));
        if (response.statusCode !== 200) {
            return cb('Response status was ' + response.statusCode);
        }

        sendReq.pipe(file);
    });

    // close() is async, call cb after close completes
    file.on('finish', () => file.close(cb));

    // check for request errors
    sendReq.on('error', (err) => {
        fs.unlink(dest);
        return cb(err.message);
    });

    file.on('error', (err) => { // Handle errors
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return cb(err.message);
    });
};

function removeOld () {
  let now = Date.now();
  console.log('Removing old');
  for (const [key, value] of Object.entries(charts)) {
    // console.log('Now: ' + now + ' key: ' + key);
    if (now - key > (3600 * 1000 * 36)) { // 4 days
      console.log('Deleting old ' + value['filename']);
      fs.unlink(chartsFolder + '/' + value['filename'], (err => {
        if (err) console.log(err);
      }));
      console.log('Deleting charts[key] ' + JSON.stringify(charts[key]));
      delete charts[key];
    }
  }
}

function refresh () {
  request('https://www.metoffice.gov.uk/weather/maps-and-charts/surface-pressure', function (error, response, html) {
    console.log('Refreshing.');
    if (!error && response.statusCode == 200) {
      var $ = cheerio.load(html);
      var listItems = $(".surface-pressure-chart ul li");
      listItems.each(function(idx, li) {
        let imgsrc = $(li).find('img').attr('src');
        let timestring = $(li).attr('data-value');
        // 00:00 (UTC) on Fri 4 Dec 2020
        var tsParts = timestring.split(' ');
        var timestamp = tsParts[6] + ' ' + tsParts[5] + ' ' + tsParts[4] + ' ' + tsParts[0] + ':00 UTC';
        var timestamp = Date.parse(timestamp);
        let id = $(li).attr('id');
        let basename = path.basename(imgsrc);
        let filename = basename + ".gif";
        if (id.includes('chartColour')) {
          if (charts[timestamp] != undefined) {
            //console.log('defined')
            if (charts[timestamp]['timestring'] != timestring) {
               //console.log('Updating timestring for ' + filename + 'from' + charts[timestamp]['timestring'] + ' to ' + timestring);
            } else {
              //console.log('Setting timestring for ' + filename + ' to ' + timestring);
            }

            // Check if previous file exists
            let current_filename = charts[timestamp]['filename'];
            //console.log('filename ' + filename + ' vs ' + current_filename);
            if (filename != current_filename) {
              if (fs.existsSync(chartsFolder + '/' + current_filename)) {
                fs.unlink(chartsFolder + '/' + current_filename, (err => {
                  if (err) console.log(err);
                }));
                //console.log('Deleted previous chart ' + current_filename);
              }
            } else {
              //console.log('filename ' + filename + ' did not change')
            }

          } else {
            //console.log('undefined')
          }
          if (fs.existsSync(chartsFolder + '/' + filename)) {
            // console.log(filename + ' exists already');
          } else {
            // console.log(filename + ' does not exist yet')
            // Download the file
            // console.log('Downloading ' + filename);
            download(imgsrc, chartsFolder + '/' + filename);
          }
          // Store new data
          charts[timestamp] = {
            filename: filename,
            id: id,
            timestamp: timestamp,
            timestring: timestring,
            imgsrc: imgsrc
          };
        }
      });
    saveInfo();
  } else {
    // console.log('Error downloading MET page. ' + error);
  }
    //console.log(JSON.stringify(charts));
  });
}


function setSchedule () {
  var j = schedule.scheduleJob('45 8,20 * * *', function() {
    refresh()
  });
}

app.use(express.static(chartsFolder));

app.route('/refresh').get(function(req,res) {
    refresh();
    res.redirect('/');
});

app.route('/').get(function(req,res) {
  var response = '<html><title>MET Office surface pressure charts</title><body>\
    <form method="get" action="/refresh"> \
      <button type="submit">Refresh</button> \
    </form>';

  let T0 = Math.round(Date.now() / 3600000);

  for (const [key, value] of Object.entries(charts)) {
    // console.log(key + ": " + JSON.stringify(value));
    let T = Math.round(key/3600000);
    let Tdiff = T - T0;
    if (Tdiff > 0) {
      Tdiff = '+' + Tdiff;
    }
    response = response + "<b>T" + Tdiff + " " + value['timestring'] + "</b></br><img src=\"" + value['filename'] + "\">" + "</br>";
  };

  response = response + "</body>";
  res.send(response);
});

app.listen(3005, function () {
    //console.log('Listening on http://localhost:3005/');
});

//setInterval (refresh, 3600 * 1000); // Hourly

setSchedule();
loadInfo();
refresh();
