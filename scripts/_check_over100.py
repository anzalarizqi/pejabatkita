import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")
from supabase import create_client

sb = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

wilayah = sb.table("wilayah").select("id,nama,level,parent_id,kode_bps").execute().data
w_by_id = {w["id"]: w for w in wilayah}

over100 = ["Papua Barat", "Papua", "Kalimantan Barat", "Kepulauan Bangka Belitung", "Jawa Barat", "Maluku", "Jawa Tengah", "Sumatera Utara"]

for prov_name in over100:
    prov = next((w for w in wilayah if w["nama"] == prov_name and w["level"] == "provinsi"), None)
    if not prov:
        print(f"{prov_name}: NOT FOUND")
        continue
    children = [w for w in wilayah if w["parent_id"] == prov["id"]]
    expected = 2 + 2 * len(children)

    # Get jabatan for this province
    jab_prov = sb.table("jabatan").select("pejabat_id,wilayah_id,posisi").eq("wilayah_id", prov["id"]).eq("status", "aktif").execute().data
    # Count jabatan per kab/kota
    kab_jabatan = {}
    for c in children:
        jab = sb.table("jabatan").select("pejabat_id,posisi").eq("wilayah_id", c["id"]).eq("status", "aktif").execute().data
        if len(jab) > 2:
            kab_jabatan[c["nama"]] = [j["posisi"] for j in jab]

    print(f"\n{prov_name}: {len(children)} kab/kota, expected={expected}")
    if kab_jabatan:
        print(f"  Kab/kota with >2 jabatan:")
        for k, v in kab_jabatan.items():
            print(f"    {k}: {v}")
    print(f"  Province-level jabatan: {[j['posisi'] for j in jab_prov]}")
