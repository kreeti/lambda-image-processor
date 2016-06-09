// dependencies
var async = require('async');
var path = require('path');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({
  imageMagick: true
});

var fs = require('fs');
var util = require('util');

// get reference to S3 client

var s3 = new AWS.S3();

exports.handler = function(event, context) {
  var srcBucket = event.bucket.name;
  var dstBucket = srcBucket;
  var rotationDegree = event.rotation
  // Object key may have spaces or unicode non-ASCII characters.
  var srcKey = decodeURIComponent(event.location.replace(/\+/g, " ")).substr(1);

  var _75px = { width: 75, dstnKey: srcKey, destinationPath: "thumb" };
  var _200px = { width: 200, dstnKey: srcKey, destinationPath: "medium" };
  var _600px = { width: 600, dstnKey: srcKey, destinationPath: "large" };

  var _sizesArray = [_75px, _200px, _600px];

  // Infer the image type.
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

  async.forEachOf(_sizesArray, function(value, key, callback) {
    async.waterfall([
      function download(next) {
        s3.getObject({
          Bucket: srcBucket,
          Key: srcKey
        }, next);
      },

      function convert(response, next) {
        gm(response.Body).antialias(true).density(300).toBuffer('JPG', function(err, buffer) {
          if (err) {
            next(err);
          } else {
            next(null, buffer);
          }
        });
      },

      function process(response, next) {
        gm(response).size(function(err, size) {
          if(err) { console.log(err); return; }

          var width = _sizesArray[key].width;
          var height = width;
          var index = key;

          if(key == 2) {
            var resized = this.resize(width, height, "!").fill("#FFFFFF").fontSize(30).drawText(10, 10, "MeraYog.com", "SouthWest");
            //var resized = this.resize(width, height).gravity("SouthWest").draw(['image over 0,0 0,0 /var/task/watermark.png'])
          } else {
            var resized = this.resize(width, height, "!");
          }

          if(rotationDegree) {
            resized = resized.rotate("#FFFFFF", rotationDegree)
          }

          resized.background('#FFFFFF').gravity('Center').noProfile().interlace('Plane').samplingFactor(2, 1).toBuffer(
            'JPG', function(err, buffer) {
              console.log("Printing the buffer...");
              console.log(buffer);

              if (err) {
                next(err);
              } else {
                next(null, buffer, key);
              }
            });
        });
      },

      function upload(data, index, next) {
        console.time("uploadImage");
        pathWithFolder = srcKey.split('/').slice(0, 5).join('/')
        console.log("upload to path : " + pathWithFolder + "/" + _sizesArray[index].destinationPath + "/" + fileName.slice(0, -4) + ".jpg");

        s3.putObject({
          Bucket: dstBucket,
          Key: pathWithFolder + "/" + _sizesArray[index].destinationPath + "/" + fileName.slice(0, -4) + ".jpg",
          Body: data,
          ContentType: 'JPG',
          ACL: 'public-read'
        }, next);
        console.timeEnd("uploadImage");
      }
    ], function(err, result) {
      if (err) {
        console.error(err);
      }

      console.log("End of step " + key);
      callback();
    });
  }, function(err) {
    if (err) {
      console.error('---->Unable to resize ' + srcBucket + '/' + srcKey + ' and upload to ' + dstBucket +
                    '/images' + ' due to an error: ' + err);
    } else {
      console.log('---->Successfully resized ' + srcBucket + ' and uploaded to' + dstBucket + "/images");
    }
    context.done();
  });
};