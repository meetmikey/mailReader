
exports.readMail = function(err, message, callback) {
  if ( err ) {
    console.error('Error: mailReader: readMail: got error from mailReader queue: ', err)
  } else {
    console.log('got mailReader message: ', message);
  }
  callback();
}