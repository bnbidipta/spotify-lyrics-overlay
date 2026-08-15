using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

class SecureStore {
    static void Main(string[] args) {
        if (args.Length < 1) {
            Console.Error.WriteLine("Usage: secure_store.exe [save-b64|load|clear|encrypt|decrypt] [args...]");
            return;
        }
        string action = args[0].ToLower();

        try {
            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SpotifyLyricsOverlay");
            if (!Directory.Exists(appData)) Directory.CreateDirectory(appData);

            if (action == "save-b64" && args.Length >= 3) {
                string key = args[1];
                string b64Input = args[2];
                byte[] plaintextBytes = Convert.FromBase64String(b64Input);
                byte[] ciphertextBytes = ProtectedData.Protect(plaintextBytes, null, DataProtectionScope.CurrentUser);
                File.WriteAllText(Path.Combine(appData, key + ".dat"), Convert.ToBase64String(ciphertextBytes), Encoding.UTF8);
                Console.WriteLine("OK");
            } else if (action == "save" && args.Length >= 3) {
                string key = args[1];
                string data = args[2];
                byte[] plaintextBytes = Encoding.UTF8.GetBytes(data);
                byte[] ciphertextBytes = ProtectedData.Protect(plaintextBytes, null, DataProtectionScope.CurrentUser);
                File.WriteAllText(Path.Combine(appData, key + ".dat"), Convert.ToBase64String(ciphertextBytes), Encoding.UTF8);
                Console.WriteLine("OK");
            } else if (action == "load" && args.Length >= 2) {
                string key = args[1];
                string filePath = Path.Combine(appData, key + ".dat");
                if (File.Exists(filePath)) {
                    string base64 = File.ReadAllText(filePath, Encoding.UTF8).Trim();
                    if (!string.IsNullOrEmpty(base64)) {
                        byte[] ciphertextBytes = Convert.FromBase64String(base64);
                        byte[] plaintextBytes = ProtectedData.Unprotect(ciphertextBytes, null, DataProtectionScope.CurrentUser);
                        Console.WriteLine(Convert.ToBase64String(plaintextBytes));
                        return;
                    }
                }
                Console.WriteLine("");
            } else if (action == "clear" && args.Length >= 2) {
                string key = args[1];
                string filePath = Path.Combine(appData, key + ".dat");
                if (File.Exists(filePath)) File.Delete(filePath);
                Console.WriteLine("OK");
            } else if (action == "encrypt" && args.Length >= 2) {
                byte[] plaintextBytes = Encoding.UTF8.GetBytes(args[1]);
                byte[] ciphertextBytes = ProtectedData.Protect(plaintextBytes, null, DataProtectionScope.CurrentUser);
                Console.WriteLine(Convert.ToBase64String(ciphertextBytes));
            } else if (action == "decrypt" && args.Length >= 2) {
                byte[] ciphertextBytes = Convert.FromBase64String(args[1]);
                byte[] plaintextBytes = ProtectedData.Unprotect(ciphertextBytes, null, DataProtectionScope.CurrentUser);
                Console.WriteLine(Encoding.UTF8.GetString(plaintextBytes));
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
        }
    }
}
