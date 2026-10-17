# Langkah demi langkah di Oracle Cloud (Always Free)

Panduan ini hanya mencakup bagian Console Oracle, yaitu dari akun yang baru aktif sampai bisa masuk SSH. Setelah itu lanjutkan ke `DEPLOY.md`.

Perkiraan waktu: 20 menit.

Ringkasan fase:

- **A.** Siapkan kunci SSH di laptop.
- **B.** Buat instans.
- **C.** Tetapkan IP publik tetap.
- **D.** Buka port 80 dan 443.
- **E.** Masuk lewat SSH.
- **F.** Arahkan DNS, lalu lanjut ke `DEPLOY.md`.

## Fase A: Siapkan kunci SSH

Buka Git Bash di laptop, lalu buat pasangan kunci:

```bash
ssh-keygen -t ed25519 -C "melon-vps" -f ~/.ssh/melon_oracle
```

Tekan Enter dua kali (frasa sandi boleh dikosongkan), lalu tampilkan kunci publiknya:

```bash
cat ~/.ssh/melon_oracle.pub
```

Salin seluruh keluaran satu baris yang dimulai dengan `ssh-ed25519` sampai akhir. Kunci privat `~/.ssh/melon_oracle` tidak boleh dikirim ke mana pun. Simpan salinannya di penyimpanan pribadi, karena bila berkas itu hilang, akses SSH ke VPS ikut hilang.

## Fase B: Buat instans

1. Masuk ke Console, klik ikon menu di kiri atas, pilih **Compute**, lalu **Instances**.
2. Klik **Create instance**.
3. **Name**: `melon-vps`. Pakai nama generik, bukan nama proyek, karena satu VPS dapat menampung beberapa proyek kelak. Oracle memakai nama ini sebagai hostname mesin.
4. **Compartment**: biarkan pilihan bawaan.
5. **Placement**: biarkan `AD-1`. Batam hanya memiliki satu availability domain.
6. Pada **Image and shape**, klik **Edit**:
   - **Image**: pilih **Canonical Ubuntu**, versi **24.04**, dan pastikan arsitekturnya **aarch64**.
   - **Shape**: klik **Change shape**, pilih **Ampere**, lalu `VM.Standard.A1.Flex`. Atur OCPU ke **2** dan Memory ke **12 GB**. Pada baris shape akan tampak label Always Free-eligible.
7. Pada **Primary network**, pilih **Create new virtual cloud network**. Biarkan nama bawaannya. Pastikan opsi **Assign a public IPv4 address** tercentang.
8. Pada **Add SSH keys**, pilih **Paste public keys**, lalu tempel isi berkas `melon_oracle.pub` dari Fase A.
9. Pada **Boot volume**, biarkan 50 GB.
10. Klik **Create**, lalu tunggu sekitar satu menit sampai status berubah dari PROVISIONING menjadi **RUNNING**.
11. Catat **Public IP address** pada halaman instans.

Bila muncul galat "Out of host capacity", artinya kapasitas A1 sedang penuh. Coba lagi beberapa jam kemudian, atau sementara buat instans dengan shape `VM.Standard.E2.1.Micro` yang juga termasuk Always Free.

## Fase C: Tetapkan IP publik tetap

Alamat sementara terikat pada instans dan ikut terhapus bila instans dibuang. Menetapkannya sekarang menghindarkan Anda dari mengganti DNS dan menerbitkan ulang sertifikat HTTPS.

1. Pada halaman instans, buka **Resources**, lalu **Attached VNICs**.
2. Klik nama VNIC-nya.
3. Pada bagian **IPv4 Addresses**, klik menu tiga titik di kanan alamat publik, lalu pilih **Edit**.
4. Ubah dari Ephemeral public IP menjadi **Reserved public IP**, lalu pilih **Create new reserved public IP**.
5. Beri nama `melon-ip`, lalu klik **Update**.
6. Catat alamat tersebut. Alamat inilah yang dimasukkan ke DNS.

Bila susunan menu di Console berbeda, jalur alternatifnya: **Networking**, **Reserved public IPs**, **Create reserved public IP**, lalu pasang alamat itu ke instans melalui halaman VNIC yang sama.

## Fase D: Buka port 80 dan 443

Daftar keamanan bawaan hanya membuka port 22. Tanpa langkah ini, HTTPS tidak dapat diakses walaupun Caddy sudah berjalan.

1. Buka menu, pilih **Networking**, lalu **Virtual Cloud Networks**.
2. Klik VCN yang baru dibuat.
3. Pada bagian **Resources**, klik **Security Lists**, lalu klik **Default Security List for ...**.
4. Klik **Add Ingress Rules**, lalu isi:
   - Source Type: **CIDR**
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: **TCP**
   - Destination Port Range: `80`
5. Klik **Add Ingress Rules**. Ulangi langkah 4 dan 5 dengan port `443`.

Aturan keluar tidak perlu diubah karena bawaannya sudah mengizinkan semua.

## Fase E: Masuk lewat SSH

Kembali ke Git Bash:

```bash
ssh -i ~/.ssh/melon_oracle ubuntu@<IP-PUBLIK>
```

Pengguna bawaan image Ubuntu di Oracle adalah `ubuntu`, bukan `root`. Setelah berhasil masuk, perbarui paket sistem:

```bash
sudo apt update && sudo apt upgrade -y
```

Bila muncul "Permission denied (publickey)", pastikan yang dipakai adalah kunci privat (tanpa akhiran `.pub`) dan alamat IP-nya benar. Bila muncul "UNPROTECTED PRIVATE KEY FILE", jalankan `chmod 600 ~/.ssh/melon_oracle`.

## Fase F: Arahkan DNS

Di panel DNS `melonbyte.biz.id`, ubah catatan A untuk nama `@` agar menunjuk alamat IP tetap dari Fase C. Tambahkan juga catatan A untuk `www` bila diinginkan.

Periksa dari laptop:

```bash
dig +short melonbyte.biz.id
```

Bila sudah menunjuk IP VPS, lanjutkan ke `DEPLOY.md` langkah 1. Seluruh perintah di sana dapat disalin apa adanya karena image Ubuntu di Oracle sama dengan Ubuntu biasa.

## Bila ada yang macet

| Gejala | Penyebab dan tindakan |
|---|---|
| "Out of host capacity" saat Create | Kapasitas A1 penuh. Coba lagi pada jam berbeda, atau pakai `VM.Standard.E2.1.Micro` untuk sementara. |
| SSH menggantung tanpa jawaban | Instans harus berada di subnet publik dan VCN harus punya internet gateway. Keduanya dibuat otomatis bila Anda memilih "Create new virtual cloud network". |
| SSH ditolak publickey | Pastikan memakai kunci privat, bukan `.pub`, dan pengguna `ubuntu`. |
| Situs tidak terbuka padahal Caddy sudah jalan | Periksa port 80 dan 443 di Security List (Fase D), lalu periksa `sudo iptables -L INPUT -n` di dalam server. |
| Instans hilang sendiri | Instans Always Free yang dinilai menganggur boleh ditarik Oracle. Bangun ulang instans, pasang kembali IP tetap yang sama, lalu jalankan `bash deploy/deploy.sh`. |
