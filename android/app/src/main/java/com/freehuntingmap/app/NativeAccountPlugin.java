package com.freehuntingmap.app;

import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/** Google ID token for the bundled app. The web client id is the token audience. */
@CapacitorPlugin(name = "NativeAccount")
public class NativeAccountPlugin extends Plugin {
    @PluginMethod
    public void signIn(PluginCall call) {
        String serverClientId = call.getString("serverClientId");
        if (serverClientId == null || serverClientId.isEmpty() || getActivity() == null) {
            call.reject("Sign-in unavailable");
            return;
        }
        GetGoogleIdOption googleId = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(serverClientId)
            .setAutoSelectEnabled(false)
            .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(googleId).build();
        CredentialManager.create(getActivity()).getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getActivity()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    Credential credential = result.getCredential();
                    if (!(credential instanceof CustomCredential) || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        call.reject("Sign-in unavailable");
                        return;
                    }
                    try {
                        String idToken = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                        if (idToken == null || idToken.isEmpty()) {
                            call.reject("Sign-in unavailable");
                            return;
                        }
                        JSObject payload = new JSObject();
                        payload.put("credential", idToken);
                        call.resolve(payload);
                    } catch (RuntimeException error) {
                        call.reject("Sign-in unavailable");
                    }
                }

                @Override
                public void onError(GetCredentialException error) {
                    call.reject(error instanceof GetCredentialCancellationException ? "Sign-in canceled" : "Sign-in unavailable");
                }
            }
        );
    }
}
