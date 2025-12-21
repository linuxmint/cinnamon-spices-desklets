const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;

var _httpSession;
if (Soup.MAJOR_VERSION === 2) {
    _httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
} else {
    _httpSession = new Soup.Session();
}

var JiraUtility = function() {};

const IDEN = "jira@codeunifier";

JiraUtility.prototype.getAssigned = function (here, callback) {
    const url = "https://" + here.atlassianDomain + "/rest/api/3/search?jql=(assignee=currentUser() AND project=" + here.projectName + " AND status!=Done)";

    let message = Soup.Message.new('GET', url);
    let auth = new Soup.AuthBasic();

    auth.authenticate(here.accountEmail, here.apiToken);

    message.request_headers.append("Authorization", auth.get_authorization(message));

    _httpSession.timeout = 10;
    _httpSession.idle_timeout = 10;

    if (Soup.MAJOR_VERSION === 2) {
        _httpSession.queue_message(message, function (session, message) {
            if (message.status_code == 200) {
                try {
                    callback.call(here, message.response_body.data.toString());
                } catch (e) {
                    global.logError(IDEN + ': ERROR | ' + e.message);
                    callback.call(here, null);
                }
            } else {
                global.logError(IDEN + ': BAD_API | ' + message.status_code);
            }
        });
    } else {
        _httpSession.send_and_read_async(message, 0, null, (session, res) => {
            if (message.get_status() === Soup.Status.OK) {
                try {
                    const bytes = session.send_and_read_finish(res);
                    const data = ByteArray.toString(bytes.get_data());
                    callback.call(here, data);
                } catch (e) {
                    global.logError(IDEN + ': ERROR | ' + e.message);
                }
            } else {
                global.logError(IDEN + ': BAD_API | ' + message.get_status());
            }
        });
    }

};