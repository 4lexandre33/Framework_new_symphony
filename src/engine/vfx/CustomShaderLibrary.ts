import * as THREE from "three";

export class CustomShaderLibrary {
  public static createNoiseDissolveMaterial(
    noiseTexture: THREE.Texture,
    baseTexture: THREE.Texture
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBaseTexture: { value: baseTexture },
        uNoiseTexture: { value: noiseTexture },
        uDissolveProgress: { value: 0.0 }, // 0.0 = Intacto, 1.0 = Totalmente dissolvido
        uEdgeColor: { value: new THREE.Color(1.0, 0.3, 0.0) },
        uEdgeWidth: { value: 0.05 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uBaseTexture;
        uniform sampler2D uNoiseTexture;
        uniform float uDissolveProgress;
        uniform vec3 uEdgeColor;
        uniform float uEdgeWidth;

        varying vec2 vUv;

        void main() {
          float noise = texture2D(uNoiseTexture, vUv).r;
          if (noise < uDissolveProgress) discard;

          vec4 baseColor = texture2D(uBaseTexture, vUv);

          if (noise < uDissolveProgress + uEdgeWidth) {
            gl_FragColor = vec4(uEdgeColor, baseColor.a);
          } else {
            gl_FragColor = baseColor;
          }
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }

  public static createEnergyShieldMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShieldColor: { value: new THREE.Color(0.0, 0.8, 1.0) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uShieldColor;

        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);

          // Efeito Fresnel de borda reluzente
          float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 3.0);
          float pulse = sin(uTime * 4.0) * 0.15 + 0.85;

          gl_FragColor = vec4(uShieldColor, fresnel * pulse);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}