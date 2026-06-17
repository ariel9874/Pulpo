import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { isSupabaseConfigured, supabase } from "./src/lib/supabase";
import { SessionsScreen } from "./src/screens/SessionsScreen";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  return session ? (
    <SessionsScreen
      email={session.user.email ?? "—"}
      onSignOut={() => void supabase.auth.signOut()}
    />
  ) : (
    <Login />
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: "signIn" | "signUp"): Promise<void> => {
    setBusy(true);
    setError(null);
    const { error: authError } =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (authError) setError(authError.message);
    setBusy(false);
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Batuta</Text>
      {!isSupabaseConfigured && (
        <Text style={styles.warn}>
          Configura EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY.
        </Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="contraseña"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      <Pressable style={styles.button} disabled={busy} onPress={() => void submit("signIn")}>
        <Text style={styles.buttonText}>Entrar</Text>
      </Pressable>
      <Pressable style={styles.linkButton} disabled={busy} onPress={() => void submit("signUp")}>
        <Text style={styles.link}>Crear cuenta</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700" },
  text: { fontSize: 16 },
  muted: { fontSize: 13, color: "#666" },
  warn: { color: "#b00020", textAlign: "center" },
  input: {
    width: "100%",
    maxWidth: 320,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: "white", fontWeight: "600" },
  linkButton: { paddingVertical: 8 },
  link: { color: "#2563eb" },
});
