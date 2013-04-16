var environment = process.env.NODE_ENV;

//Local
var storeMailBody = false;

if (environment == 'production') {
  storeMailBody = false;  

} else if (environment == 'development') {
  storeMailBody = false;
}

module.exports = {
  storeMailBody: storeMailBody
}