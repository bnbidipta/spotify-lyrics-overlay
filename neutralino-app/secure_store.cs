using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

class SecureStore {
    static void Main(string[] args) {
        if (args.Length < 2) {
            Console.Error.WriteLine("Usage: secure_store.exe [encrypt|decrypt] [data]");
            return;
        }
        string action = args[0];
        string data = args[1];

        try {
            if (action == "encrypt") {
                byte[] plaintextBytes = Encoding.UTF8.GetBytes(data);
                byte[] ciphertextBytes = ProtectedData.Protect(plaintextBytes, null, DataProtectionScope.CurrentUser);
                Console.WriteLine(Convert.ToBase64String(ciphertextBytes));
            } else if (action == "decrypt") {
                byte[] ciphertextBytes = Convert.FromBase64String(data);
                byte[] plaintextBytes = ProtectedData.Unprotect(ciphertextBytes, null, DataProtectionScope.CurrentUser);
                Console.WriteLine(Encoding.UTF8.GetString(plaintextBytes));
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("Error: " + ex.Message);
        }
    }
}
