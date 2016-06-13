// dependencies
var async = require('async');
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
  var rotationDegree = event.rotation
  var deleteLocation = event.delete_location

  if(event.location) {
    var srcKey = decodeURIComponent(event.location.replace(/\+/g, " "));
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    var fileName = path.basename(srcKey);

    if (!typeMatch) {
      console.error('unable to infer image type for key ' + srcKey);
      return;
    }

    var imageType = typeMatch[1].toLowerCase();

    if (imageType != "jpg" && imageType != "gif" && imageType != "png" && imageType != "eps") {
      console.log('skipping non-image ' + srcKey);
      return;
    }
  }

  var _75px = { width: 75, destinationPath: "thumb" };
  var _200px = { width: 200, destinationPath: "medium" };
  var _600px = { width: 600, destinationPath: "large" };

  var _sizesArray = [_75px, _200px, _600px];

  function download(srcBucket, srcKey) {
    return new Promise(function(resolve, reject) {
      s3.getObject({
        Bucket: srcBucket,
        Key: srcKey
      }, function(err, response) {
        if(err) { reject(err) }
        else { resolve(response) };
      })
    })
  }

  function convert(response) {
    return new Promise(function(resolve, reject) {
      processedResponse = gm(response.Body).background('#FFFFFF').gravity('Center').strip().interlace('Plane').samplingFactor(2, 1);
      if (rotationDegree) { processedResponse = processedResponse.rotate("#FFFFFF", rotationDegree) }

      processedResponse.toBuffer('JPG', function(err, buffer) {
        if(err) {
          reject(err);
        }
        else {
          resolve(buffer);
        }
      })
    })
  }

  function process(response, width, style) {
    return new Promise(function(resolve, reject) {
      gm(response).size(function(err, size) {
        if(err) {
          console.log(err);
          return reject(err);
        }

        var resized = this.resize(width, width, "!");

        if(style == "large") { resized = resized.fill("#FFFFFF").fontSize(30).drawText(10, 10, "MeraYog.com", "SouthWest"); }
        if(style == "medium") { resized = resized.extent([_200px['width'], _200px['width']]) }

        resized.toBuffer('JPG', function(err, buffer) {
          if(err) { reject(err) }
          else { resolve(buffer) }
        })
      })
    })
  }

  function upload(data, style) {
    pathWithFolder = srcKey.split('/').slice(0, 5).join('/')

    return new Promise(function(resolve, reject) {
      s3.putObject({
        Bucket: dstBucket,
        Key: pathWithFolder + "/" + style + "/" + fileName.slice(0, -4) + ".jpg",
        Body: data,
        ContentType: 'JPG',
        ACL: 'public-read'
      }, function(err, data) {
        if(err) { reject(err); }
        else { resolve(true) }
      });
    });
  }

  function deleteFile(srcBucket, deletePath) {
    return new Promise(function(resolve, reject) {
      s3.deleteObject({
        Bucket: srcBucket,
        Key: deletePath,
      }, function(err, data) {
        if(err) { reject(err); }
        else { resolve(data); }
      })
    });
  }

  function deleteAllFile(deleteLocation) {
    return Promise.all(
      _sizesArray.map(function(v) {
        pathWithFolder = deleteLocation.split('/').slice(0, 5).join('/');
        fileToDelete = path.basename(deleteLocation);
        deletePath = pathWithFolder + "/" + v.destinationPath + "/" + fileToDelete;

        return deleteFile(srcBucket, deletePath);
      }));
  }

  function downloadAndUpload(srcBucket, srcKey) {
    download(srcBucket, srcKey)
      .then(convert)
      .then(function(response) {
        return Promise.all(_sizesArray.map(function(v) {
          return process(response, v.width, v.destinationPath).then(function(data) {
            upload(data, v.destinationPath);
          })
        }))
      }).then(function(results) {
        context.done();
      }).catch(function(error) {
        console.log("catching");
        console.log(error);
        context.fail();
      });
  }

  if(deleteLocation && srcKey) {
    deleteAllFile(deleteLocation).then(function(response) {
      downloadAndUpload(srcBucket, srcKey);
    });
  } else if(deleteLocation) {
    deleteAllFile(deleteLocation).then(function(response){
      context.done();
    });
  } else if(srcKey) {
    downloadAndUpload(srcBucket, srcKey);
  }
}
