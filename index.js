"use strict";

var path = require('path');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({
  imageMagick: true
});

var fs = require('fs');
var util = require('util');
var s3 = new AWS.S3();

exports.handler = function(event, context) {
  var srcBucket = event.bucket.name;
  var dstBucket = srcBucket;
  var deleteLocation = event.old_path
  var rotation = event.attributes['rotation']

  if(event.path) {
    var srcKey = decodeURIComponent(event.path.replace(/\+/g, " "));
  }

  var _sizesArray = [
    { width: 75, height: 75, style: "thumb" },
    { width: 200, height: 200, style: "medium" },
    { width: 600, height: 600, style: "large" }
  ];

  function download(srcBucket, srcKey) {
    return new Promise((resolve, reject) => {
      s3.getObject({
        Bucket: srcBucket,
        Key: srcKey
      }, (err, response) => {
        if(err)
          reject(err);
        else
          resolve(response);
      })
    })
  }

  function convert(response) {
    return new Promise((resolve, reject) => {
      var processedResponse = gm(response.Body).background('#FFFFFF').gravity('Center').strip().interlace('Plane').samplingFactor(2, 2);
      if (rotation) {
        processedResponse = processedResponse.rotate("#FFFFFF", rotation)
      }

      processedResponse.toBuffer('JPG', (err, buffer) => {
        if(err)
          reject(err);
        else
          resolve(buffer);
      })
    })
  }

  function process(response, elem) {
    return new Promise((resolve, reject) => {
      var resized;

      if(elem.style == "thumb") {
        resized = gm(response).resize(elem.width, elem.height, "!");
      } else if(elem.style == "medium") {
        resized = gm(response).resize("40000@");
      } else if(elem.style == "large") {
        resized = gm(response).resize("360000@");
        resized = resized.fill("#FFFFFF").fontSize(30).drawText(10, 10, "MeraYog.com", "SouthWest");
      }

      resized.toBuffer('JPG', (err, buffer) => {
        if(err)
          reject(err)
        else
          resolve(buffer)
      })
    })
  }

  function formattedPath(srcKey, style) {
    var pathWithFolder = srcKey.split('/').slice(0, 5).join('/');
    var fileName = path.basename(srcKey);
    return pathWithFolder + "/" + style + "/" + fileName.slice(0, -4) + ".jpg"
  }

  function upload(data, style) {
    return new Promise((resolve, reject) => {
      s3.putObject({
        Bucket: dstBucket,
        Key: formattedPath(srcKey, style),
        Body: data,
        ContentType: 'JPG',
        ACL: 'public-read'
      }, (err, data) => {
        if(err)
          reject(err);
        else
          resolve(true)
      });
    });
  }

  function deleteFile(srcBucket, deletePath) {
    return new Promise((resolve, reject) => {
      s3.deleteObject({
        Bucket: srcBucket,
        Key: deletePath,
      }, (err, data) => {
        if(err)
          reject(err);
        else
          resolve(data);
      })
    });
  }

  function deleteAllFile(deleteLocation) {
    return Promise.all(_sizesArray.map(v => deleteFile(srcBucket, formattedPath(deleteLocation, v.style))));
  }

  function downloadAndUpload(srcBucket, srcKey) {
    return download(srcBucket, srcKey)
      .then(convert)
      .then(response =>
            Promise.all(_sizesArray.map(v => process(response, v).then(data => upload(data, v.style)))));
  }

  var promise;

  if(deleteLocation && srcKey) {
    promise = Promise.all([deleteAllFile(deleteLocation), downloadAndUpload(srcBucket, srcKey)]);
  } else if(deleteLocation) {
    promise = deleteAllFile(deleteLocation);
  } else if(srcKey) {
    promise = downloadAndUpload(srcBucket, srcKey);
  }

  if(promise) {
    promise.then(response => context.done())
      .catch(error => {
        console.log(error);
        context.fail();
      });
  }
}
