const Soup = imports.gi.Soup;

const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

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
};