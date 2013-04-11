var linkHandler = require ('../../lib/linkHandler');

describe('check suspicous diffbot', function() {
  
  it("bad", function() {
    var bad1 = {
      "title" : "500 Internal Server Error" 
    }

    var bad2 = {
      "title" : "Redirect notice" 
    }

    var bad3 = {
      "title" : "404 not found",
      "summary" : "hello"  
    }

    var bad4 = {
      "title" : "page not found",
      "summary" : "hello"  
    }

    console.log (linkHandler.isDiffbotResponseSuspicious (bad1));

    expect (linkHandler.isDiffbotResponseSuspicious (bad1)).toBe (true);
    expect (linkHandler.isDiffbotResponseSuspicious (bad2)).toBe (true);
    expect (linkHandler.isDiffbotResponseSuspicious (bad3)).toBe (true);
    expect (linkHandler.isDiffbotResponseSuspicious (bad4)).toBe (true);

  });

  it("good", function() {

    var good1 = {
      "title" : "a normal title"
    }

    expect (linkHandler.isDiffbotResponseSuspicious (good1)).toBe (false);
  });
});
