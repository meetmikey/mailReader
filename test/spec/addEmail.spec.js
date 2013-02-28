var serverCommon = process.env.SERVER_COMMON;

var sqsConnect = require(serverCommon + '/lib/sqsConnect')

describe('add message to mail reader queue', function() {
  
  var myAddMessageToQueue = jasmine.createSpy('myAddMessageToQueue');
  var path = '/home/jdurack/Documents/emails/emailWith4Attachments.txt';
  var userId = '50f5034a0e189c3b48000006';

  it("Basic page", function() {

    sqsConnect.addMessageToQueue = myAddMessageToQueue;
    var message = {
        'path': path
      , 'userId': userId
    }
    sqsConnect.addMessageToMailReaderQueue( message );
  });

  it("spy called with right arguments", function() {
    expect( myAddMessageToQueue ).toHaveBeenCalled();
    expect( myAddMessageToQueue.mostRecentCall.args[0] ).toBeTruthy();
    expect( myAddMessageToQueue.mostRecentCall.args[1] ).toBeTruthy();
    expect( myAddMessageToQueue.mostRecentCall.args[1].path ).toBe( path );
    expect( myAddMessageToQueue.mostRecentCall.args[1].userId ).toBe( userId );
  });
});
