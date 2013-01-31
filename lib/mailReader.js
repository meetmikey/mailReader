var MailParser = require('mailparser').MailParser
  , fs = require("fs")


var mailReader = this;

exports.readMail = function(err, messageString, callback) {
  if ( err ) {
    console.error('Error: mailReader: readMail: got error from mailReader queue: ', err)
  } else {
    console.log('got mailReader message: ', messageString);
    var message = JSON.parse(messageString);
    var emailPath = message.path;

    console.log('emailPath: ' + emailPath);

    var mailParser = new MailParser();
    mailParser.on("end", mailReader.processMail );
    fs.createReadStream( emailPath ).pipe( mailParser );
  }
  callback();
}

exports.processMail = function( mail ) {
  console.log("Subject:", mail.subject );
};