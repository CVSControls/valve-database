using System.Runtime.InteropServices;
using System.Text;

namespace ValveDatabaseUploader;

public static class CredentialStore
{
    private const string Target = "CVSControls.ValveDatabaseUploader.SupabasePassword";
    private const uint Generic = 1, LocalMachine = 2;

    public static void Save(string token)
    {
        var bytes = Encoding.Unicode.GetBytes(token);
        var pointer = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var credential = new NativeCredential { Type = Generic, TargetName = Target, CredentialBlobSize = (uint)bytes.Length, CredentialBlob = pointer, Persist = LocalMachine, UserName = Environment.UserName };
            if (!CredWrite(ref credential, 0)) throw new InvalidOperationException($"Windows Credential Manager rejected the password ({Marshal.GetLastWin32Error()}).");
        }
        finally { Marshal.FreeCoTaskMem(pointer); }
    }

    public static string? Read()
    {
        if (!CredRead(Target, Generic, 0, out var pointer)) return null;
        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(pointer);
            return credential.CredentialBlob == IntPtr.Zero ? null : Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
        }
        finally { CredFree(pointer); }
    }

    public static void Delete() => CredDelete(Target, Generic, 0);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags, Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredWrite(ref NativeCredential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
}
