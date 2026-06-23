"""
Self-contained decoder for ijai / 3irobotix Xiaomi vacuum cloud map files.

Verified against:
  - tooljose88/HA-custom-components-Xiaomi-Cloud-Map-Extractor-Ijai-Support
    (custom_components/xiaomi_cloud_map_extractor/ijai/{aes_decryptor,map_data_parser,image_handler,vacuum}.py)

Target device: Xiaomi S40 Pro  (model = xiaomi.vacuum.ov71gl, bucket 3irobotic-ov71gl)

Pipeline:
  1. parse {"version":2,"data":"<base64>"}          -> base64 string `data`
  2. derive AES-128 key from device identifiers       -> 16-byte key (hex)
  3. AES-128-ECB decrypt(base64decode(data)) + unpad  -> ASCII hex text
  4. bytes.fromhex(text)                               -> zlib stream
  5. zlib.decompress                                   -> protobuf (RobotMap)
  6. protobuf parse -> mapHead (sizeX/sizeY) + mapData.mapData grid
  7. render grid bytes -> PIL.Image

Dependencies:  pip install pycryptodome pillow protobuf

REQUIRED inputs (all are baked into the key — wrong value => padding error / garbage):
  did       : device_id (numeric string, e.g. "1234567890")     <- you have this
  model     : full model string, e.g. "xiaomi.vacuum.ov71gl"     <- you have this
  device_mac: device wifi MAC "AA:BB:CC:DD:EE:FF" (any case)      <- from /home_device_list
  owner_id  : Xiaomi account uid that OWNS the device (numeric)   <- your account uid
  wifi_sn   : device wifi serial number (string, <=18 chars)      <- MUST be probed from device

  `token`/`ssecurity` are NOT used by the key derivation. `token` is only used by
  the HA code to *probe* wifi_sn over miIO (get_property_by(siid=7, piid=45),
  comma-split, take field index 11, strip quotes, first 18 chars). ssecurity is
  unrelated (it is the MiCloud API request-signing secret, not a map key).
"""

import base64
import hashlib
import json
import zlib

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

# ---------------------------------------------------------------------------
# Embedded RobotMap protobuf descriptor (serialized FileDescriptorProto).
# Lets us parse without shipping RobotMap_pb2.py / running protoc.
# ---------------------------------------------------------------------------
_DESC_B64 = (
    "Cg5Sb2JvdE1hcC5wcm90byKpGAoIUm9ib3RNYXASDwoHbWFwVHlwZRgBIAEoDRIoCgptYXBFeHRJbmZvGAIgASgLMhQuUm9ib3RNYXAuTWFwRXh0SW5mbxImCgdtYXBIZWFkGAMgASgLMhUuUm9ib3RNYXAuTWFwSGVhZEluZm8SJgoHbWFwRGF0YRgEIAEoCzIVLlJvYm90TWFwLk1hcERhdGFJbmZvEiUKB21hcEluZm8YBSADKAsyFC5Sb2JvdE1hcC5BbGxNYXBJbmZvEjQKC2hpc3RvcnlQb3NlGAYgASgLMh8uUm9ib3RNYXAuRGV2aWNlSGlzdG9yeVBvc2VJbmZvEjMKDWNoYXJnZVN0YXRpb24YByABKAsyHC5Sb2JvdE1hcC5EZXZpY2VQb3NlRGF0YUluZm8SNAoLY3VycmVudFBvc2UYCCABKAsyHy5Sb2JvdE1hcC5EZXZpY2VDdXJyZW50UG9zZUluZm8SMgoMdmlydHVhbFdhbGxzGAkgAygLMhwuUm9ib3RNYXAuRGV2aWNlQXJlYURhdGFJbmZvEi8KCWFyZWFzSW5mbxgKIAMoCzIcLlJvYm90TWFwLkRldmljZUFyZWFEYXRhSW5mbxJBChBuYXZpZ2F0aW9uUG9pbnRzGAsgAygLMicuUm9ib3RNYXAuRGV2aWNlTmF2aWdhdGlvblBvaW50RGF0YUluZm8SLAoMcm9vbURhdGFJbmZvGAwgAygLMhYuUm9ib3RNYXAuUm9vbURhdGFJbmZvEi4KCnJvb21NYXRyaXgYDSABKAsyGi5Sb2JvdE1hcC5EZXZpY2VSb29tTWF0cml4EjQKCXJvb21DaGFpbhgOIAMoCzIhLlJvYm90TWFwLkRldmljZVJvb21DaGFpbkRhdGFJbmZvEikKB29iamVjdHMYDyADKAsyGC5Sb2JvdE1hcC5PYmplY3REYXRhSW5mbxIyCg1mdXJuaXR1cmVJbmZvGBAgAygLMhsuUm9ib3RNYXAuRnVybml0dXJlRGF0YUluZm8SJwoKaG91c2VJbmZvcxgRIAMoCzITLlJvYm90TWFwLkhvdXNlSW5mbxIxCgtiYWNrdXBBcmVhcxgSIAMoCzIcLlJvYm90TWFwLkRldmljZUFyZWFEYXRhSW5mbxpyCglIb3VzZUluZm8SCgoCaWQYASABKA0SDAoEbmFtZRgCIAEoCRITCgtjdXJNYXBDb3VudBgDIAEoDRISCgptYXhNYXBTaXplGAQgASgNEiIKBG1hcHMYBSADKAsyFC5Sb2JvdE1hcC5BbGxNYXBJbmZvGqEBChFGdXJuaXR1cmVEYXRhSW5mbxIKCgJpZBgBIAEoDRIOCgZ0eXBlSWQYAiABKA0SKQoGcG9pbnRzGAMgAygLMhkuUm9ib3RNYXAuRGV2aWNlUG9pbnRJbmZvEgsKA3VybBgEIAEoCRIOCgZzdGF0dXMYBSABKA0SKAoFcmVhY3QYBiADKAsyGS5Sb2JvdE1hcC5EZXZpY2VQb2ludEluZm8akQEKDk9iamVjdERhdGFJbmZvEhAKCG9iamVjdElkGAEgASgNEhQKDG9iamVjdFR5cGVJZBgCIAEoDRISCgpvYmplY3ROYW1lGAMgASgJEg8KB2NvbmZpcm0YBCABKA0SCQoBeBgFIAEoAhIJCgF5GAYgASgCEgsKA3VybBgHIAEoCRIPCgdub3RTaG93GAggASgNGj8KGERldmljZUNoYWluUG9pbnREYXRhSW5mbxIJCgF4GAEgASgNEgkKAXkYAiABKA0SDQoFdmFsdWUYAyABKA0aXQoXRGV2aWNlUm9vbUNoYWluRGF0YUluZm8SDgoGcm9vbUlkGAEgASgNEjIKBnBvaW50cxgCIAMoCzIiLlJvYm90TWFwLkRldmljZUNoYWluUG9pbnREYXRhSW5mbxoiChBEZXZpY2VSb29tTWF0cml4Eg4KBm1hdHJpeBgBIAEoDBpnChdDbGVhblBlcmZlcmVuY2VEYXRhSW5mbxIRCgljbGVhbk1vZGUYASABKA0SEgoKd2F0ZXJMZXZlbBgCIAEoDRIRCgl3aW5kUG93ZXIYAyABKA0SEgoKdHdpY2VDbGVhbhgEIAEoDRqRAgoMUm9vbURhdGFJbmZvEg4KBnJvb21JZBgBIAEoDRIQCghyb29tTmFtZRgCIAEoCRISCgpyb29tVHlwZUlkGAMgASgNEhIKCm1ldGVyaWFsSWQYBCABKA0SEgoKY2xlYW5TdGF0ZRgFIAEoDRIRCglyb29tQ2xlYW4YBiABKA0SFgoOcm9vbUNsZWFuSW5kZXgYByABKA0SLwoMcm9vbU5hbWVQb3N0GAggASgLMhkuUm9ib3RNYXAuRGV2aWNlUG9pbnRJbmZvEjYKC2NsZWFuUGVyZmVyGAkgASgLMiEuUm9ib3RNYXAuQ2xlYW5QZXJmZXJlbmNlRGF0YUluZm8SDwoHY29sb3JJZBgKIAEoDRp2Ch1EZXZpY2VOYXZpZ2F0aW9uUG9pbnREYXRhSW5mbxIPCgdwb2ludElkGAEgASgNEg4KBnN0YXR1cxgCIAEoDRIRCglwb2ludFR5cGUYAyABKA0SCQoBeBgEIAEoAhIJCgF5GAUgASgCEgsKA3BoaRgGIAEoAhonCg9EZXZpY2VQb2ludEluZm8SCQoBeBgBIAEoAhIJCgF5GAIgASgCGnAKEkRldmljZUFyZWFEYXRhSW5mbxIOCgZzdGF0dXMYASABKA0SDAoEdHlwZRgCIAEoDRIRCglhcmVhSW5kZXgYAyABKA0SKQoGcG9pbnRzGAQgAygLMhkuUm9ib3RNYXAuRGV2aWNlUG9pbnRJbmZvGloKFURldmljZUN1cnJlbnRQb3NlSW5mbxIOCgZwb3NlSWQYASABKA0SDgoGdXBkYXRlGAIgASgNEgkKAXgYAyABKAISCQoBeRgEIAEoAhILCgNwaGkYBSABKAIaRwoSRGV2aWNlUG9zZURhdGFJbmZvEgkKAXgYASABKAISCQoBeRgCIAEoAhILCgNwaGkYAyABKAISDgoGcm9vbUlkGAQgASgNGkAKGERldmljZUNvdmVyUG9pbnREYXRhSW5mbxIOCgZ1cGRhdGUYASABKA0SCQoBeBgCIAEoAhIJCgF5GAMgASgCGm0KFURldmljZUhpc3RvcnlQb3NlSW5mbxIOCgZwb3NlSWQYASABKA0SMgoGcG9pbnRzGAIgAygLMiIuUm9ib3RNYXAuRGV2aWNlQ292ZXJQb2ludERhdGFJbmZvEhAKCHBhdGhUeXBlGAMgASgNGjAKCkFsbE1hcEluZm8SEQoJbWFwSGVhZElkGAEgASgNEg8KB21hcE5hbWUYAiABKAkaHgoLTWFwRGF0YUluZm8SDwoHbWFwRGF0YRgBIAEoDBqKAQoLTWFwSGVhZEluZm8SEQoJbWFwSGVhZElkGAEgASgNEg0KBXNpemVYGAIgASgNEg0KBXNpemVZGAMgASgNEgwKBG1pblgYBCABKAISDAoEbWluWRgFIAEoAhIMCgRtYXhYGAYgASgCEgwKBG1heFkYByABKAISEgoKcmVzb2x1dGlvbhgIIAEoAhotChBDYXJwZXRPZmZzZXRJbmZvEgsKA3BoaRgBIAEoAhIMCgRkaXN0GAIgASgCGl0KD01hcEJvdW5kYXJ5SW5mbxIOCgZtYXBNZDUYASABKAkSDQoFdk1pblgYAiABKA0SDQoFdk1heFgYAyABKA0SDQoFdk1pblkYBCABKA0SDQoFdk1heFkYBSABKA0ajwIKCk1hcEV4dEluZm8SFQoNdGFza0JlZ2luRGF0ZRgBIAEoDRIVCg1tYXBVcGxvYWREYXRlGAIgASgNEhAKCG1hcFZhbGlkGAMgASgNEg4KBnJhZGlhbhgEIAEoDRINCgVmb3JjZRgFIAEoDRIRCgljbGVhblBhdGgYBiABKA0SLwoMYm91bmRhcnlJbmZvGAcgASgLMhkuUm9ib3RNYXAuTWFwQm91bmRhcnlJbmZvEhIKCm1hcFZlcnNpb24YCCABKA0SFAoMbWFwVmFsdWVUeXBlGAkgASgNEjQKEGNhcnBldE9mZnNldEluZm8YCiABKAsyGi5Sb2JvdE1hcC5DYXJwZXRPZmZzZXRJbmZvYgZwcm90bzM="
)


def _load_robotmap_class():
    """Build the RobotMap protobuf message class from the embedded descriptor."""
    from google.protobuf import descriptor_pool
    from google.protobuf.internal import builder as _builder

    pool = descriptor_pool.DescriptorPool()
    fd = pool.AddSerializedFile(base64.b64decode(_DESC_B64))
    ns = {}
    _builder.BuildMessageAndEnumDescriptors(fd, ns)
    _builder.BuildTopDescriptorsAndMessages(fd, "RobotMap_pb2", ns)
    return ns["RobotMap"]


# ---------------------------------------------------------------------------
# Key derivation  (verbatim port of ijai/aes_decryptor.py)
# ---------------------------------------------------------------------------
def _aes_ecb_encrypt_b64(plaintext: str, key: str) -> str:
    cipher = AES.new(key.encode("utf-8"), AES.MODE_ECB)
    enc = cipher.encrypt(pad(plaintext.encode("utf-8"), AES.block_size, "pkcs7"))
    return base64.b64encode(enc).decode("utf-8")


def _gen_md5_key(wifi_sn: str, owner_id: str, device_id: str,
                 model: str, device_mac: str) -> str:
    """Returns the 32-hex-char (=> 16-byte AES-128) map key."""
    # inner key = mac(no colons, lowercase) + last-segment-of-model normalised to 4 chars
    pjstr = "".join(device_mac.lower().split(":"))
    tail = model.split(".")[-1]
    if len(tail) == 2:
        tail = "00" + tail
    elif len(tail) == 3:
        tail = "0" + tail
    elif len(tail) > 4:
        tail = tail[-4:]
    inner_key = pjstr + tail                       # e.g. "aabbccddeeff" + "71gl" (16 bytes)

    joined = "+".join([wifi_sn or "", owner_id or "", device_id or ""])
    aeskey_b64 = _aes_ecb_encrypt_b64(joined, inner_key)
    return hashlib.md5(aeskey_b64.encode("utf-8")).hexdigest()   # hex => bytes.fromhex => 16B


def _decrypt(data_b64: str, wifi_sn, owner_id, device_id, model, device_mac) -> bytes:
    key_hex = _gen_md5_key(str(wifi_sn or ""), str(owner_id or ""),
                           str(device_id or ""), model, device_mac)
    cipher = AES.new(bytes.fromhex(key_hex), AES.MODE_ECB)
    decrypted = cipher.decrypt(base64.b64decode(data_b64))
    decrypted = unpad(decrypted, AES.block_size, "pkcs7")
    # NB: ijai plaintext is ASCII-hex text of the real (zlib) payload
    return bytes.fromhex(decrypted.decode("utf-8"))


# ---------------------------------------------------------------------------
# Pixel -> colour mapping  (from ijai/image_handler.py)
# ---------------------------------------------------------------------------
MAP_OUTSIDE = 0x00            # not-mapped / void
MAP_WALL = 0xFF              # wall
MAP_SCAN = 0x01             # scanned floor
MAP_NEW_DISCOVERED_AREA = 0x02
MAP_ROOM_MIN, MAP_ROOM_MAX = 10, 59           # room id == pixel value
MAP_SEL_ROOM_MIN, MAP_SEL_ROOM_MAX = 60, 109  # "selected/cleaned" room: id = v-60+10

_COLORS = {
    "outside": (0, 0, 0, 0),         # transparent
    "wall":    (50, 60, 80, 255),
    "scan":    (160, 200, 255, 255),
    "new":     (200, 220, 255, 255),
    "unknown": (40, 40, 40, 255),
}
# deterministic-ish palette for rooms (room_number % len)
_ROOM_PALETTE = [
    (240, 178, 122, 255), (133, 193, 233, 255), (125, 206, 160, 255),
    (195, 155, 211, 255), (247, 220, 111, 255), (245, 183, 177, 255),
    (174, 214, 241, 255), (171, 235, 198, 255),
]


def decode_ijai_map(raw_json_bytes,
                    did=None, model=None, token=None,
                    ssecurity=None, wifi_sn=None,
                    owner_id=None, device_mac=None,
                    return_meta=False):
    """
    Decode a 3irobotix/ijai vacuum cloud map into a PIL.Image (RGBA).

    raw_json_bytes : bytes/str of {"version":2,"data":"<base64>"} OR the raw
                     base64 string itself OR already-base64-decoded bytes.

    REQUIRED for correct decryption (all fold into the AES key):
        did         device_id   (numeric string)
        model       e.g. "xiaomi.vacuum.ov71gl"
        device_mac  "AA:BB:CC:DD:EE:FF"
        owner_id    account uid that owns the device (numeric string)
        wifi_sn     device wifi serial (probe from device; see module docstring)

    token / ssecurity are accepted for signature compatibility but NOT used here.
    """
    # ---- 1. parse the {"version":2,"data":...} envelope ----------------
    data_b64 = None
    if isinstance(raw_json_bytes, (bytes, bytearray)):
        try:
            obj = json.loads(raw_json_bytes.decode("utf-8"))
            data_b64 = obj["data"]
        except (ValueError, KeyError, UnicodeDecodeError):
            data_b64 = None
    elif isinstance(raw_json_bytes, str):
        try:
            obj = json.loads(raw_json_bytes)
            data_b64 = obj["data"]
        except (ValueError, KeyError):
            data_b64 = raw_json_bytes        # assume it's already the base64 string

    if data_b64 is None:
        # caller passed already-base64-decoded ciphertext bytes -> re-encode
        data_b64 = base64.b64encode(bytes(raw_json_bytes)).decode("ascii")

    # ---- 2/3/4. derive key, AES-128-ECB decrypt, hex->bytes ------------
    zlib_stream = _decrypt(data_b64, wifi_sn, owner_id, did, model, device_mac)

    # ---- 5. decompress -------------------------------------------------
    proto_bytes = zlib.decompress(zlib_stream)

    # ---- 6. protobuf parse --------------------------------------------
    RobotMap = _load_robotmap_class()
    rm = RobotMap()
    rm.ParseFromString(proto_bytes)

    w = rm.mapHead.sizeX
    h = rm.mapHead.sizeY
    grid = rm.mapData.mapData
    if w == 0 or h == 0 or len(grid) < w * h:
        raise ValueError(f"bad map dims w={w} h={h} grid={len(grid)}")

    # ---- 7. render -----------------------------------------------------
    from PIL import Image
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for iy in range(h):
        # source row-major y*w+x ; flip vertically so image y-up matches map
        out_y = h - 1 - iy
        base = iy * w
        for x in range(w):
            v = grid[base + x]
            if v == MAP_OUTSIDE:
                c = _COLORS["outside"]
            elif v == MAP_WALL:
                c = _COLORS["wall"]
            elif v == MAP_SCAN:
                c = _COLORS["scan"]
            elif v == MAP_NEW_DISCOVERED_AREA:
                c = _COLORS["new"]
            elif MAP_ROOM_MIN <= v <= MAP_SEL_ROOM_MAX:
                room = v if v <= MAP_ROOM_MAX else (v - MAP_SEL_ROOM_MIN + MAP_ROOM_MIN)
                c = _ROOM_PALETTE[room % len(_ROOM_PALETTE)]
            else:
                c = _COLORS["unknown"]
            px[x, out_y] = c

    if not return_meta:
        return img

    def m2i(p):  # map(metres) -> image px (ijai constants)
        return (p * 20 + 400)

    meta = {
        "size": (w, h),
        "head": {
            "minX": rm.mapHead.minX, "minY": rm.mapHead.minY,
            "maxX": rm.mapHead.maxX, "maxY": rm.mapHead.maxY,
            "resolution": rm.mapHead.resolution,
        },
        "vacuum": (rm.currentPose.x, rm.currentPose.y, rm.currentPose.phi),
        "charger": (rm.chargeStation.x, rm.chargeStation.y, rm.chargeStation.phi),
        "rooms": [(r.roomId, r.roomName) for r in rm.roomDataInfo],
        "map_to_image": "px = metres*20 + 400 ; metres = (px-400)/20",
    }
    return img, meta


if __name__ == "__main__":
    import sys
    # Usage:
    #   python decode_ijai_map.py map.json out.png \
    #       did model device_mac owner_id wifi_sn
    if len(sys.argv) < 8:
        print(__doc__)
        sys.exit(0)
    raw = open(sys.argv[1], "rb").read()
    img, meta = decode_ijai_map(
        raw,
        did=sys.argv[3], model=sys.argv[4], device_mac=sys.argv[5],
        owner_id=sys.argv[6], wifi_sn=sys.argv[7], return_meta=True)
    img.save(sys.argv[2])
    print("saved", sys.argv[2], meta)
