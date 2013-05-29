var serverCommon = process.env.SERVER_COMMON;

var constants = require ('../constants')
    , linkHandler = require ('../lib/linkHandler')
    , winston = require(serverCommon + '/lib/winstonWrapper').winston

var mail = {
  bodyHTML : '<body tr><div ><div class="mktEditable" ><table border="0" cellspacing="0" cellpadding="0" width="640" bgcolor="#DDDDDD"><tbody><tr><td colspan="3" height="20"></td></tr><tr><td width="20"></td><td><table style="font-family: sans-serif;" border="0" cellspacing="0" cellpadding="0" width="600" bgcolor="#FFFFFF"><tbody><tr><td height="54" align="right"><a href="http://mkto-g0116.com/track?type=click&enid=bWFpbGluZ2lkPXlhbW1lckJldGFjdXN0LTIxNDEtNjM2Mi0wLTI2MjUtcHJvZC00MDQ4Jm1lc3NhZ2VpZD0wJmRhdGFiYXNlaWQ9NDA0OCZzZXJpYWw9MTI2NTQ5NjAyMyZlbWFpbGlkPXNhZ2FyQGRlbG9zdGVjaG5vbG9naWVzLmNvbSZ1c2VyaWQ9ODE0ODIyOS0xJmV4dHJhPSYmJg==&&&http://www.yammer.com?mkt_tok=3RkMMJWWfF9wsRokuqjIZKXonjHpfsXw6uglW6W%2FlMI%2F0ER3fOvrPUfGjI4DSsBnI%2FqLAzICFpZo2FFBG%2B2YeZI%3D"><img style="display: block;" src="http://marketing.yammer.com/rs/yammer/images/devices-logo-top.gif" border="0" alt="yammer" width="118" height="53" /></a></td></tr><tr>'
}

winston.doInfo('too much html', {'hasTooMuchHTML', linkHandler.mailHasTooMuchHTML(mail), mail: mail});