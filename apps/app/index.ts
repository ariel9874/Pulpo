// Polyfill de crypto.getRandomValues para que tweetnacl pueda firmar en nativo.
// Debe ir ANTES de cualquier uso de la API de firma. En web ya existe.
import "react-native-get-random-values";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
