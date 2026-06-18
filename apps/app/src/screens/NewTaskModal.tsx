import type { AgentType, Machine } from "@batuta/protocol";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { backend } from "../lib/backend";
import { isSpeechSupported, startDictation } from "../lib/speech";

const AGENTS: AgentType[] = ["claude-code", "echo"];

export function NewTaskModal({
  visible,
  machines,
  onClose,
}: {
  visible: boolean;
  machines: Machine[];
  onClose: () => void;
}) {
  const [machineId, setMachineId] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<AgentType>("claude-code");
  const [cwd, setCwd] = useState(".");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const stopDictation = useRef<(() => void) | null>(null);
  const speechOk = isSpeechSupported();

  const selectedMachine = machineId ?? machines[0]?.id ?? null;
  const canLaunch = Boolean(selectedMachine) && prompt.trim().length > 0 && !busy;

  const toggleDictation = (): void => {
    if (listening) {
      stopDictation.current?.();
      stopDictation.current = null;
      setListening(false);
      return;
    }
    const stop = startDictation({
      onText: (text) => setPrompt((prev) => (prev ? `${prev} ${text}` : text)),
      onEnd: () => {
        stopDictation.current = null;
        setListening(false);
      },
      onError: () => {
        stopDictation.current = null;
        setListening(false);
      },
    });
    if (stop) {
      stopDictation.current = stop;
      setListening(true);
    }
  };

  const launch = async (): Promise<void> => {
    if (!selectedMachine || !prompt.trim()) return;
    setBusy(true);
    try {
      await backend.sendCommand({
        type: "new_task",
        machineId: selectedMachine,
        agentType,
        cwd: cwd.trim() || ".",
        prompt: prompt.trim(),
      });
      setPrompt("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Nueva tarea</Text>
          {machines.length === 0 ? (
            <Text style={styles.muted}>Empareja una PC primero (ejecuta el runner: pair).</Text>
          ) : (
            <>
              <Text style={styles.label}>Máquina</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chips}>
                  {machines.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => setMachineId(m.id)}
                      style={[styles.chip, selectedMachine === m.id && styles.chipOn]}
                    >
                      <Text style={selectedMachine === m.id ? styles.chipOnText : styles.chipText}>
                        {m.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.label}>Agente</Text>
              <View style={styles.chips}>
                {AGENTS.map((a) => (
                  <Pressable
                    key={a}
                    onPress={() => setAgentType(a)}
                    style={[styles.chip, agentType === a && styles.chipOn]}
                  >
                    <Text style={agentType === a ? styles.chipOnText : styles.chipText}>{a}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Directorio (cwd)</Text>
              <TextInput
                style={styles.input}
                value={cwd}
                onChangeText={setCwd}
                autoCapitalize="none"
                placeholder="."
              />

              <View style={styles.labelRow}>
                <Text style={styles.label}>Tarea</Text>
                {speechOk ? (
                  <Pressable onPress={toggleDictation} style={styles.mic}>
                    <Text style={listening ? styles.micOn : styles.micText}>
                      {listening ? "● Grabando… (toca para parar)" : "🎤 Dictar"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={prompt}
                onChangeText={setPrompt}
                multiline
                placeholder="¿Qué quieres que haga el agente?"
              />
            </>
          )}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => void launch()}
              disabled={!canLaunch}
              style={[styles.launchBtn, !canLaunch && styles.disabled]}
            >
              <Text style={styles.launchText}>Lanzar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 4 },
  muted: { color: "#666", paddingVertical: 12 },
  label: { fontSize: 12, color: "#64748b", marginTop: 8 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  mic: { paddingVertical: 4, paddingHorizontal: 6 },
  micText: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  micOn: { fontSize: 12, color: "#dc2626", fontWeight: "700" },
  chips: { flexDirection: "row", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipText: { color: "#334155" },
  chipOnText: { color: "white", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  cancelText: { color: "#64748b", fontWeight: "600" },
  launchBtn: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  launchText: { color: "white", fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
