import json
import base64
from Crypto.Cipher import PKCS1_v1_5
from Crypto.PublicKey import RSA
import sys
param = sys.argv[1]

def decode_rsa(tokenString, key_path) :
    key = RSA.importKey(open(key_path, mode = 'rb').read())
    cipher = PKCS1_v1_5.new(key)
    barray = bytearray(base64.b64decode(tokenString))
    realToken = cipher.decrypt(barray, len(barray)).decode('UTF-8')
    return realToken

token = decode_rsa(param,"private.der")
print(token)

