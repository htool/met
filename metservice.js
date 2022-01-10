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

function debug (msg) {
  console.log(msg);
}

function saveInfo () {
  console.log('Saving ' + Object.keys(charts).length)
  fs.writeFileSync(chartsJson, JSON.stringify(charts), (err) => {
    if (err) throw err;
  });
}

function loadInfo () {
  if (fs.existsSync(chartsJson)) {
    charts = JSON.parse(fs.readFileSync(chartsJson, 'utf8'));
    debug('Loaded charts: ' + JSON.stringify(charts));
  }
  removeOld();
}


async function download (url, dest, cb) {
    const file = fs.createWriteStream(dest);
    const sendReq = request.get(url);

    debug('Start downloading ' + url);
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
        debug('Error downloading ' + url);
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return cb(err.message);
    });
};

async function removeOld () {
  let now = Date.now();
  console.log('Removing old');
  for (const [key, value] of Object.entries(charts)) {
    // console.log('Now: ' + now + ' key: ' + key);
    if (now - key > (3600 * 1000 * 36)) { // 36 hours
      debug('Deleting old ' + value['filename']);
      fs.unlink(chartsFolder + '/' + value['filename'], (err => {
        if (err) console.log(err);
      }));
      debug('Deleting charts[key] ' + JSON.stringify(charts[key]));
      delete charts[key];
    }
  }
}

async function refresh () {
  removeOld();
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
               debug('Updating timestring for ' + filename + 'from' + charts[timestamp]['timestring'] + ' to ' + timestring);
            } else {
              debug('Setting timestring for ' + filename + ' to ' + timestring);
            }

            // Check if previous file exists
            let current_filename = charts[timestamp]['filename'];
            debug('Checking filename ' + filename + ' vs ' + current_filename);
            if (filename != current_filename) {
              if (fs.existsSync(chartsFolder + '/' + current_filename)) {
                fs.unlink(chartsFolder + '/' + current_filename, (err => {
                  if (err) console.log(err);
                }));
                debug('Deleted previous chart ' + current_filename);
              }
            } else {
              debug('filename ' + filename + ' did not change')
            }

          } else {
            //console.log('undefined')
          }
          if (fs.existsSync(chartsFolder + '/' + filename)) {
            debug(filename + ' exists already');
          } else {
            debug(filename + ' does not exist yet')
            // Download the file
            debug('Downloading ' + filename);
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
    res.redirect('back');
});


app.route('/').get(function(req,res) {
  var response = '<html>\
    <head>\
      <link rel="stylesheet" href="http://mfdstore.navico.com/Content/navigation.css">\
      <title>MET Office surface pressure charts</title><body>\
    </head>\
    <form method="get" action="/refresh"> \
      <button type="submit">Refresh</button> \
    </form>';

  let T0 = Math.round(Date.now() / 3600000);

  for (const [key, value] of Object.entries(charts).sort()) {
    // console.log(key + ": " + JSON.stringify(value));
    let T = Math.round(key/3600000);
    let Tdiff = T - T0;
    if (Tdiff > 0) {
      Tdiff = '+' + Tdiff;
    }
    response = response + "<b>T" + Tdiff + " " + value['timestring'] + "</b></br><img src=\"" + value['filename'] + "\">" + "</br>";
    debug("Reponse: " + key + " " + Tdiff + " " + value['timestring'] + " " + value['filename'])
  };

  response = response + "</body>";
  res.send(response);
});

app.route('/slideshow').get(function(req,res) {
  var response = '<html><title>MET Office surface pressure charts</title> \
  <meta name="viewport" content="width=device-width, initial-scale=1"> \
  <link rel="stylesheet" href="slideshow.css"> \
  <style>.myMaps {display:none;}</style><body>';
  response = response + "<div class=\"w3-center\">";
  response = response + "<div class=\"w3-content w3-display-container\">";

  let T0 = Math.round(Date.now() / 3600000);

  for (const [key, value] of Object.entries(charts).sort()) {
    // console.log(key + ": " + JSON.stringify(value));
    let T = Math.round(key/3600000);
    let Tdiff = T - T0;
    if (Tdiff > 0) {
      Tdiff = '+' + Tdiff;
    }
    response = response + '<div class="w3-display-container myMaps">\n<img src="' + value['filename'] + '" style="width:100%">\n';
    response = response + '<div class="w3-display-topmiddle w3-container w3-padding-16 w3-black">T ' + Tdiff + '</div></div>';
    //Tdiff + value['timestring']
  //  <button class=\"w3-button demo\" onclick=\"currentDiv(1)\">" + Tdiff + "</button>
  //  </div>";

  };
  response = response + '<button class="w3-display-left w3-button" onclick="plusDivs(-1)"><b>&lt;</b></button> \
                         <button class="w3-display-right w3-button" onclick="plusDivs(1)"><b>&gt;</b></button>';

  response = response + '<script src="slideshow.js"></script> \
    <div class="w3-display-bottommiddle "><form method="get" action="/refresh"> \
    <button type="submit">Refresh</button></form></div></body>';
  res.send(response);
});

app.listen(3005, function () {
    //console.log('Listening on http://localhost:3005/');
});

//setInterval (refresh, 3600 * 1000); // Hourly

setSchedule();
loadInfo();
refresh();
