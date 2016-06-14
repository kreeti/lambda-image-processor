// dependencies
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

  var _75px = { width: 75, style: "thumb" };
  var _200px = { width: 200, style: "medium" };
  var _600px = { width: 600, style: "large" };
  var _sizesArray = [_75px, _200px, _600px];

  function download(srcBucket, srcKey) {
    return new Promise((resolve, reject) => {
      s3.getObject({
        Bucket: srcBucket,
        Key: srcKey
      }, (err, response) => {
        if(err) {
          reject(err);
        }
        else {
          resolve(response);
        };
      })
    })
  }

  function convert(response) {
    return new Promise((resolve, reject) => {
      processedResponse = gm(response.Body).background('#FFFFFF').gravity('Center').strip().interlace('Plane').samplingFactor(2, 1);
      if (rotationDegree) {
        processedResponse = processedResponse.rotate("#FFFFFF", rotationDegree)
      }

      processedResponse.toBuffer('JPG', (err, buffer) => {
        if(err) {
          reject(err);
        }
        else {
          resolve(buffer);
        }
      })
    })
  }

  function process(response, elem) {
    return new Promise((resolve, reject) => {
      gm(response).size((err, size) => {
        if(err) {
          reject(err);
        }

        var resized = this.resize(elem.width, elem.width, "!");

        if(elem.style == "large") {
          resized = resized.fill("#FFFFFF").fontSize(30).drawText(10, 10, "MeraYog.com", "SouthWest");
        }

        if(elem.style == "medium") {
          resized = resized.extent([_200px['width'], _200px['width']])
        }

        resized.toBuffer('JPG', (err, buffer) => {
          if(err) { reject(err) }
          else { resolve(buffer) }
        })
      })
    })
  }

  function upload(data, style) {
    pathWithFolder = srcKey.split('/').slice(0, 5).join('/')

    return new Promise((resolve, reject) => {
      s3.putObject({
        Bucket: dstBucket,
        Key: pathWithFolder + "/" + style + "/" + fileName.slice(0, -4) + ".jpg",
        Body: data,
        ContentType: 'JPG',
        ACL: 'public-read'
      }, (err, data) => {
        if(err) {
          reject(err);
        }
        else {
          resolve(true)
        }
      });
    });
  }

  function deleteFile(srcBucket, deletePath) {
    return new Promise((resolve, reject) => {
      s3.deleteObject({
        Bucket: srcBucket,
        Key: deletePath,
      }, (err, data) => {
        if(err) {
          reject(err);
        }
        else {
          resolve(data);
        }
      })
    });
  }

  function deleteAllFile(deleteLocation) {
    return Promise.all(
      _sizesArray.map(v => {
        pathWithFolder = deleteLocation.split('/').slice(0, 5).join('/');
        fileToDelete = path.basename(deleteLocation);
        deletePath = pathWithFolder + "/" + v.style + "/" + fileToDelete;

        return deleteFile(srcBucket, deletePath);
      }));
  }

  function downloadAndUpload(srcBucket, srcKey) {
    return new Promise((resolve, reject) => {
      download(srcBucket, srcKey)
        .then(convert)
        .then(response => {
          return Promise.all(_sizesArray.map(v => {
            return process(response, v).then(data => {
              return upload(data, v.style);
            })
          }))
        });
    });
  }

  if(deleteLocation && srcKey) {
    Promise.all([deleteAllFile(deleteLocation), downloadAndUpload(srcBucket, srcKey)])
      .then(response => {
        context.done();
      })
      .catch(response => {
        console.log("catching");
        context.fail();
      });
  } else if(deleteLocation) {
    deleteAllFile(deleteLocation).then(response => context.done());
  } else if(srcKey) {
    downloadAndUpload(srcBucket, srcKey)
      .then(response => context.done())
      .catch(err => {
        console.log(err);
        context.fail();
      });
  }
}
