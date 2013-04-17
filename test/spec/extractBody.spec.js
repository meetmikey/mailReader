var serverCommon = process.env.SERVER_COMMON;

var fs = require('fs')
  , linkHandler = require('../../lib/linkHandler')
  , constants = require(serverCommon + '/constants')

describe('extract body from html', function() {

  it("Basic page", function() {
    var body = '';
    var bodyCompare = "Some other shit in here is really great. This is a header. This is bold.";
    runs( function() {
      var filename = './test/data/titleTest.html';
      fs.readFile( filename, 'utf8', function(err, data) {
        expect( err ).toBeNull();
        body = linkHandler.extractSummaryFromHTML( data );
        console.log (body)
      });
    });
    waitsFor( function() {
      return ( body == bodyCompare );
    }, "body never set", 1000);
  });


  it("Mind sumo", function() {
    var body = '';
    var bodyCompare = "MindSumo is a marketplace for innovation. We bring the brightest and most creative minds in the country together to solve complex challenges faced by large organizations.";
    runs( function() {
      var filename = './test/data/mindSumo.html';
      fs.readFile( filename, 'utf8', function(err, data) {
        expect( err ).toBeNull();
        body = linkHandler.extractSummaryFromHTML( data );
        console.log (body)
      });
    });
    waitsFor( function() {
      return ( body == bodyCompare );
    }, "body never set", 1000);
  });

  it("stack", function() {
    var body = '';
    var bodyCompareLen = constants.LINK_SUMMARY_CUTOFF;
    runs( function() {
      var filename = './test/data/stack.html';
      fs.readFile( filename, 'utf8', function(err, data) {
        expect( err ).toBeNull();
        body = linkHandler.extractSummaryFromHTML( data );
        console.log ('body from stack', body)
      });
    });
    waitsFor( function() {
      return ( body.length == bodyCompareLen );
    }, "body length doesn't match", 1000);
  });

});