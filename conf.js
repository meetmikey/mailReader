var environment = process.env.NODE_ENV;

//Local
var storeMailBody = false;

if (environment == 'production') {
  storeMailBody = false;  

} else if (environment == 'development') {
  storeMailBody = false;
}

module.exports = {
    diffbot : {
      token : 'b45dc70b4a560b2b106a136212486c0e'
  }
  , googleDriveAPIFileGetPrefix: 'https://www.googleapis.com/drive/v2/files/'
  , storeMailBody: storeMailBody
}