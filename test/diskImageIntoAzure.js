var serverCommon = process.env.SERVER_COMMON;
var azureUtils = require (serverCommon + '/lib/azureUtils');

azureUtils.putStreamFromFile('static/ee0222d8aa88d8e895a08baa529b259d326c7d0d2d6917e1b9156c932572aa72', 'hello.jpg', function (err, path) {
  if (err) {
    console.error ('test failed', err);
    return;
  }

  console.log ('path', path);
});