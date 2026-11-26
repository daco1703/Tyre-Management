package in.tyresaathi.logbook;

import android.content.res.Resources;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotificationConfig")
public class NotificationConfigPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        // Google Services generates these only when a real Android client
        // configuration was supplied. Never call FirebaseMessaging without it.
        boolean configured = hasString("google_app_id")
            && hasString("gcm_defaultSenderId")
            && hasString("google_api_key")
            && hasString("project_id");
        JSObject result = new JSObject();
        result.put("configured", configured);
        call.resolve(result);
    }

    private boolean hasString(String name) {
        Resources resources = getContext().getResources();
        int identifier = resources.getIdentifier(name, "string", getContext().getPackageName());
        return identifier != 0 && !resources.getString(identifier).trim().isEmpty();
    }
}
