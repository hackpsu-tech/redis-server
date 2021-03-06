#!/bin/bash
PASSPHRASE="hackdaddy"
if [[ ! -f key.pem || ! -f cert.pem ]] ;then
    # generate private key and enter pass phrase
    openssl genrsa -des3 -passout pass:${PASSPHRASE} -out key.pem 2048

    # create certificate signing request, enter "*" as a "Common Name", leave "challenge password" blank
    openssl req -new -sha256 -key key.pem -passin pass:${PASSPHRASE} -out server.csr

    # generate self-signed certificate for 1 year
    openssl req -x509 -sha256 -days 365 -key key.pem -passin pass:${PASSPHRASE} -in server.csr -out cert.pem

    # validate the certificate
    openssl req -in server.csr -text -noout | grep -i "Signature.*SHA256"
    if [[ $? ]]; then
        echo "All is well"
    else
        echo "This certificate doesn't work in 2017! You must update OpenSSL to generate a widely-compatible certificate"
        exit 1
    fi
    # remove certain files
    rm server.csr
fi

unameOut="$(uname -s)"
case "${unameOut}" in
    Linux*)
        sed -i "s/SSL_KEY_PASS=.*/SSL_KEY_PASS=$PASSPHRASE/g" ../../../../.env
	sed -i "s/USE_HTTPS=false/USE_HTTPS=true/g" ../../../../.env
        ;;

    Darwin*)
        # update passphrase to unlock files
        sed -i "" "s/SSL_KEY_PASS=.*/SSL_KEY_PASS=$PASSPHRASE/g" ../../../../.env
        # update .env flag to enable https
        sed -i "" "s/USE_HTTPS=false/USE_HTTPS=true/g" ../../../../.env
        ;;
    *)
            echo "Unknown platform." >&2
            ;;
esac


echo "Enabled HTTPS!!"
# get fingerprint
echo "Save this fingerprint for verifying Redis identity on Scanners:"
openssl x509 -noout -in cert.pem -fingerprint
echo "Formatted for use in Scanners:"
 openssl x509 -noout -in cert.pem -fingerprint | awk -F= '{print $2;}' | sed "s/:/, /g" | awk '{for (i = 1; i <= NF; i++) {printf "0x%s",$i ;} } END {printf "\n";}'
