var serverCommon = process.env.SERVER_COMMON;

var fs = require('fs')
  , linkHandler = require('../../lib/linkHandler')

describe('extract title from html', function() {

  it("Basic page", function() {
    var title = '';
    var titleCompare = "this is my title!";
    runs( function() {
      var filename = './test/data/titleTest.html';
      fs.readFile( filename, 'utf8', function(err, data) {
        expect( err ).toBeNull();
        title = linkHandler.extractTitleFromHTML( data );
      });
    });
    waitsFor( function() {
      return ( title == titleCompare );
    }, "title never set", 1000);
  });

  it("Mind Sumo page", function() {
    var title = '';
    var titleCompare = "MindSumo";
    runs( function() {
      var filename = './test/data/mindSumo.html';
      fs.readFile( filename, 'utf8', function(err, data) {
        expect( err ).toBeNull();
        title = linkHandler.extractTitleFromHTML( data );
      });
    });
    waitsFor( function() {
      return ( title == titleCompare );
    }, "title never set", 10000);
  });
});