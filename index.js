"use strict";

var path = require('path');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true });

var fs = require('fs');
var util = require('util');
var s3 = new AWS.S3();

exports.handler = function(event, context) {
  var srcBucket = event.bucket;
  var dstBucket = srcBucket;
  var deleteLocation = event.old_path;

  if(event.attributes) {
    var rotation = event.attributes['rotation']
  }

  if(event.path) {
    var srcKey = decodeURIComponent(event.path.replace(/\+/g, " "));
  }

  var sizesArray = ["thumb", "medium", "large"];

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

      processedResponse.toBuffer('jpg', (err, buffer) => {
        if(err)
          reject(err);
        else
          resolve(buffer);
      })
    })
  }

  function process(response, size) {
    return new Promise((resolve, reject) => {
      var resized;

      if(size == "thumb") {
        resized = gm(response).resize("75", "75", "!");
      } else if(size == "medium") {
        resized = gm(response).resize("40000@");
      } else if(size == "large") {
        resized = gm(response).resize("360000@").fill("#FFFFFF").fontSize(30).drawText(10, 10, "MeraYog.com", "SouthWest");
      }

      resized.toBuffer('jpg', (err, buffer) => {
        if(err)
          reject(err)
        else
          resolve(buffer)
      })
    })
  }

  function formattedPath(srcKey, style) {
    var splittedDirectory = path.dirname(srcKey).split('/');
    splittedDirectory.pop();
    var ext = path.extname(srcKey), filename = path.basename(srcKey);
    return path.join(splittedDirectory.join("/"), style, filename.substring(0, filename.lastIndexOf(ext)) + ".jpg")
  }

  function upload(data, style) {
    return new Promise((resolve, reject) => {
      s3.putObject({
        Bucket: dstBucket,
        Key: formattedPath(srcKey, style),
        Body: data,
        ContentType: 'JPG',
        ACL: 'public-read',
        CacheControl: 'max-age=315576000'
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
    return Promise.all(sizesArray.map(size => deleteFile(srcBucket, formattedPath(deleteLocation, size))));
  }

  function downloadAndUpload(srcBucket, srcKey) {
    return download(srcBucket, srcKey)
      .then(convert)
      .then(response =>
         Promise.all(sizesArray.map(size => process(response, size).then(data => upload(data, size)))));
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
        console.error(error);
        context.fail();
      });
  }
}
