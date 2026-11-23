#version 300 es

// Three.js r187 - Node System


// extensions


// precision

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp samplerCube;
precision highp sampler2DArray;

precision highp usampler2D;
precision highp usampler3D;
precision highp usamplerCube;
precision highp usampler2DArray;

precision highp isampler2D;
precision highp isampler3D;
precision highp isamplerCube;
precision highp isampler2DArray;

precision highp sampler2DShadow;
precision highp sampler2DArrayShadow;
precision highp samplerCubeShadow;


// structs

layout( location = 0 ) out vec4 fragColor;



// uniforms

layout( std140 ) uniform object {
	vec3 nodeUniform0;
	vec3 nodeUniform1;
	float nodeUniform2;
	vec3 nodeUniform3;
	uint nodeUniform5;
	uint nodeUniform6;
	uint nodeUniform7;
	uint nodeUniform8;
	uint nodeUniform9;
	uint nodeUniform10;
	uint nodeUniform11;
	uint nodeUniform12;
	uint nodeUniform13;
	uint nodeUniform14;
	vec3 nodeUniform16;
	float nodeUniform17;
	mat3 nodeUniform21;
	mat4 nodeUniform27;
};

layout( std140 ) uniform render {
	mat4 cameraProjectionMatrix;
	mat4 cameraViewMatrix;
	vec3 nodeUniform19;
	vec3 nodeUniform23;
	vec3 nodeUniform18;
	vec3 nodeUniform24;
	float nodeUniform25;
	float nodeUniform26;
	vec2 nodeUniform15;
};
uniform sampler2D nodeUniform4;

// varyings
in vec3 v_positionView;
in vec2 nodeVarying3;
flat  in vec4 nodeVarying4;
in vec4 nodeVarying5;
in vec3 nodeVarying6;
in vec3 v_normalViewGeometry;


// vars
vec4 DiffuseColor;
vec4 nodeVar1;
vec2 nodeVar2;
vec2 nodeVar3;
bool nodeVar4;
vec2 nodeVar5;
vec4 nodeVar6;
vec4 nodeVar7;
float nodeVar8;
vec2 nodeVar9;
vec2 nodeVar10;
bool nodeVar11;
vec2 nodeVar12;
vec4 nodeVar13;
vec2 nodeVar14;
vec2 nodeVar15;
bool nodeVar16;
vec2 nodeVar17;
vec4 nodeVar18;
vec2 nodeVar19;
vec2 nodeVar20;
bool nodeVar21;
vec2 nodeVar22;
vec4 nodeVar23;
float nodeVar24;
vec2 nodeVar25;
vec2 nodeVar26;
bool nodeVar27;
vec2 nodeVar28;
vec4 nodeVar29;
vec2 nodeVar30;
vec2 nodeVar31;
bool nodeVar32;
vec2 nodeVar33;
vec4 nodeVar34;
vec2 nodeVar35;
vec2 nodeVar36;
bool nodeVar37;
vec2 nodeVar38;
vec4 nodeVar39;
float nodeVar40;
vec2 nodeVar41;
vec2 nodeVar42;
bool nodeVar43;
vec2 nodeVar44;
vec4 nodeVar45;
float nodeVar46;
vec2 nodeVar47;
vec2 nodeVar48;
bool nodeVar49;
vec2 nodeVar50;
vec4 nodeVar51;
float nodeVar52;
vec2 nodeVar53;
vec2 nodeVar54;
bool nodeVar55;
vec2 nodeVar56;
vec4 nodeVar57;
float nodeVar58;
vec4 Output;
vec3 irradiance;
vec3 normalViewGeometry;
vec3 normalView;
vec3 normalWorld;
vec3 indirectDiffuse;
float ambientOcclusion;
vec3 totalDiffuse;
vec3 directDiffuse;
vec3 totalSpecular;
vec3 directSpecular;
vec3 indirectSpecular;
vec3 outgoingLight;
vec4 nodeVar59;

// codes


void main() {

	// flow
	// code

	nodeVar1 = vec4( 0.0, 0.0, 0.0, 0.0 );
	vec2 nodeConst3 = dFdx( nodeVarying3 );
	vec2 nodeConst4 = vec2( textureSize( nodeUniform4, 0 ) );
	vec2 nodeConst5 = dFdy( nodeVarying3 );
	float nodeConst6 = max( length( ( nodeConst3 * nodeConst4 ) ), length( ( nodeConst5 * nodeConst4 ) ) );

	if ( ( nodeConst6 < 1.3 ) ) {

		nodeVar2 = nodeVarying3;
		nodeVar4 = bool( nodeUniform5 );

		if ( nodeVar4 ) {

			nodeVar5 = nodeVar2;
			nodeVar3 = vec2( nodeVar5.x, 1.0 - nodeVar5.y );

		} else {

			nodeVar3 = nodeVar2;

		}

		nodeVar6 = textureLod( nodeUniform4, nodeVar3, 0.0 );
		nodeVar1 = nodeVar6;
		

	} else {


		if ( ( nodeConst6 < 2.3 ) ) {

			nodeVar8 = 2.0;

		} else {

			nodeVar8 = 3.0;

		}

		vec2 nodeConst7 = ( ( vec2( 0.5, 0.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst8 = ( vec2( 0.5, 0.5 ) / nodeConst4 );
		vec2 nodeConst9 = ( min( nodeVarying4.xy, nodeVarying4.zw ) + nodeConst8 );
		vec2 nodeConst10 = ( max( nodeVarying4.xy, nodeVarying4.zw ) - nodeConst8 );
		vec2 nodeConst11 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst7.x ) ) ) + ( nodeConst5 * vec2( nodeConst7.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar9 = nodeConst11;
		nodeVar11 = bool( nodeUniform6 );

		if ( nodeVar11 ) {

			nodeVar12 = nodeVar9;
			nodeVar10 = vec2( nodeVar12.x, 1.0 - nodeVar12.y );

		} else {

			nodeVar10 = nodeVar9;

		}

		nodeVar13 = textureLod( nodeUniform4, nodeVar10, 0.0 );
		vec2 nodeConst12 = ( ( vec2( 1.5, 0.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst13 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst12.x ) ) ) + ( nodeConst5 * vec2( nodeConst12.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar14 = nodeConst13;
		nodeVar16 = bool( nodeUniform7 );

		if ( nodeVar16 ) {

			nodeVar17 = nodeVar14;
			nodeVar15 = vec2( nodeVar17.x, 1.0 - nodeVar17.y );

		} else {

			nodeVar15 = nodeVar14;

		}

		nodeVar18 = textureLod( nodeUniform4, nodeVar15, 0.0 );
		vec2 nodeConst14 = ( ( vec2( 2.5, 0.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst15 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst14.x ) ) ) + ( nodeConst5 * vec2( nodeConst14.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar19 = nodeConst15;
		nodeVar21 = bool( nodeUniform8 );

		if ( nodeVar21 ) {

			nodeVar22 = nodeVar19;
			nodeVar20 = vec2( nodeVar22.x, 1.0 - nodeVar22.y );

		} else {

			nodeVar20 = nodeVar19;

		}

		nodeVar23 = textureLod( nodeUniform4, nodeVar20, 0.0 );

		if ( ( nodeVar8 > 2.5 ) ) {

			nodeVar24 = 1.0;

		} else {

			nodeVar24 = 0.0;

		}

		vec2 nodeConst16 = ( ( vec2( 0.5, 1.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst17 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst16.x ) ) ) + ( nodeConst5 * vec2( nodeConst16.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar25 = nodeConst17;
		nodeVar27 = bool( nodeUniform9 );

		if ( nodeVar27 ) {

			nodeVar28 = nodeVar25;
			nodeVar26 = vec2( nodeVar28.x, 1.0 - nodeVar28.y );

		} else {

			nodeVar26 = nodeVar25;

		}

		nodeVar29 = textureLod( nodeUniform4, nodeVar26, 0.0 );
		vec2 nodeConst18 = ( ( vec2( 1.5, 1.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst19 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst18.x ) ) ) + ( nodeConst5 * vec2( nodeConst18.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar30 = nodeConst19;
		nodeVar32 = bool( nodeUniform10 );

		if ( nodeVar32 ) {

			nodeVar33 = nodeVar30;
			nodeVar31 = vec2( nodeVar33.x, 1.0 - nodeVar33.y );

		} else {

			nodeVar31 = nodeVar30;

		}

		nodeVar34 = textureLod( nodeUniform4, nodeVar31, 0.0 );
		vec2 nodeConst20 = ( ( vec2( 2.5, 1.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst21 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst20.x ) ) ) + ( nodeConst5 * vec2( nodeConst20.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar35 = nodeConst21;
		nodeVar37 = bool( nodeUniform11 );

		if ( nodeVar37 ) {

			nodeVar38 = nodeVar35;
			nodeVar36 = vec2( nodeVar38.x, 1.0 - nodeVar38.y );

		} else {

			nodeVar36 = nodeVar35;

		}

		nodeVar39 = textureLod( nodeUniform4, nodeVar36, 0.0 );

		if ( ( nodeVar8 > 2.5 ) ) {

			nodeVar40 = 1.0;

		} else {

			nodeVar40 = 0.0;

		}

		vec2 nodeConst22 = ( ( vec2( 0.5, 2.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst23 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst22.x ) ) ) + ( nodeConst5 * vec2( nodeConst22.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar41 = nodeConst23;
		nodeVar43 = bool( nodeUniform12 );

		if ( nodeVar43 ) {

			nodeVar44 = nodeVar41;
			nodeVar42 = vec2( nodeVar44.x, 1.0 - nodeVar44.y );

		} else {

			nodeVar42 = nodeVar41;

		}

		nodeVar45 = textureLod( nodeUniform4, nodeVar42, 0.0 );

		if ( ( nodeVar8 > 2.5 ) ) {

			nodeVar46 = 1.0;

		} else {

			nodeVar46 = 0.0;

		}

		vec2 nodeConst24 = ( ( vec2( 1.5, 2.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst25 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst24.x ) ) ) + ( nodeConst5 * vec2( nodeConst24.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar47 = nodeConst25;
		nodeVar49 = bool( nodeUniform13 );

		if ( nodeVar49 ) {

			nodeVar50 = nodeVar47;
			nodeVar48 = vec2( nodeVar50.x, 1.0 - nodeVar50.y );

		} else {

			nodeVar48 = nodeVar47;

		}

		nodeVar51 = textureLod( nodeUniform4, nodeVar48, 0.0 );

		if ( ( nodeVar8 > 2.5 ) ) {

			nodeVar52 = 1.0;

		} else {

			nodeVar52 = 0.0;

		}

		vec2 nodeConst26 = ( ( vec2( 2.5, 2.5 ) / vec2( nodeVar8 ) ) - vec2( 0.5 ) );
		vec2 nodeConst27 = clamp( ( ( nodeVarying3 + ( nodeConst3 * vec2( nodeConst26.x ) ) ) + ( nodeConst5 * vec2( nodeConst26.y ) ) ), nodeConst9, nodeConst10 );
		nodeVar53 = nodeConst27;
		nodeVar55 = bool( nodeUniform14 );

		if ( nodeVar55 ) {

			nodeVar56 = nodeVar53;
			nodeVar54 = vec2( nodeVar56.x, 1.0 - nodeVar56.y );

		} else {

			nodeVar54 = nodeVar53;

		}

		nodeVar57 = textureLod( nodeUniform4, nodeVar54, 0.0 );

		if ( ( nodeVar8 > 2.5 ) ) {

			nodeVar58 = 1.0;

		} else {

			nodeVar58 = 0.0;

		}

		vec4 nodeConst28 = ( ( ( ( ( ( ( ( ( ( vec4( 0.0, 0.0, 0.0, 0.0 ) + ( vec4( ( nodeVar13.xyz * vec3( nodeVar13.w ) ), nodeVar13.w ) * vec4( 1.0 ) ) ) + ( vec4( ( nodeVar18.xyz * vec3( nodeVar18.w ) ), nodeVar18.w ) * vec4( 1.0 ) ) ) + ( vec4( ( nodeVar23.xyz * vec3( nodeVar23.w ) ), nodeVar23.w ) * vec4( nodeVar24 ) ) ) + ( vec4( ( nodeVar29.xyz * vec3( nodeVar29.w ) ), nodeVar29.w ) * vec4( 1.0 ) ) ) + ( vec4( ( nodeVar34.xyz * vec3( nodeVar34.w ) ), nodeVar34.w ) * vec4( 1.0 ) ) ) + ( vec4( ( nodeVar39.xyz * vec3( nodeVar39.w ) ), nodeVar39.w ) * vec4( nodeVar40 ) ) ) + ( vec4( ( nodeVar45.xyz * vec3( nodeVar45.w ) ), nodeVar45.w ) * vec4( nodeVar46 ) ) ) + ( vec4( ( nodeVar51.xyz * vec3( nodeVar51.w ) ), nodeVar51.w ) * vec4( nodeVar52 ) ) ) + ( vec4( ( nodeVar57.xyz * vec3( nodeVar57.w ) ), nodeVar57.w ) * vec4( nodeVar58 ) ) ) / vec4( ( nodeVar8 * nodeVar8 ) ) );

		if ( ( nodeConst28.w > 0.0 ) ) {

			nodeVar7 = vec4( ( nodeConst28.xyz / vec3( nodeConst28.w ) ), nodeConst28.w );

		} else {

			nodeVar7 = vec4( 0.0, 0.0, 0.0, 0.0 );

		}

		nodeVar1 = nodeVar7;
		

	}


	if ( ( nodeVar1.w < 0.5 ) ) {

		discard;
		

	}

	vec2 nodeConst29 = mod( floor( vec2( gl_FragCoord.xy.x, nodeUniform15.y - gl_FragCoord.xy.y ) ), vec2( 4.0 ) );

	if ( ( ( nodeVarying5.y > 0.0 ) && ( ( ( ( nodeConst29.x * 4.0 ) + nodeConst29.y ) / 16.0 ) < nodeVarying5.y ) ) ) {

		discard;
		

	}

	DiffuseColor = vec4( mix( min( ( ( nodeVar1.xyz * nodeVarying6 ) * nodeUniform16 ), vec3( 1.0, 1.0, 1.0 ) ), vec3( 1.0, 1.0, 1.0 ), nodeVarying5.x ), 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * nodeUniform17 );
	DiffuseColor.w = 1.0;
	irradiance = vec3( 0.0, 0.0, 0.0 );
	normalViewGeometry = normalize( v_normalViewGeometry );
	normalView = normalViewGeometry;
	normalWorld = normalize( ( vec4( normalView, 0.0 ) * cameraViewMatrix ).xyz );
	irradiance = ( irradiance + mix( nodeUniform18, nodeUniform19, ( ( dot( normalWorld, normalize( nodeUniform23 ) ) * 0.5 ) + 0.5 ) ) );
	indirectDiffuse = vec3( 0.0, 0.0, 0.0 );
	indirectDiffuse = vec4( 0.0, 0.0, 0.0, 0.0 ).xyz;
	indirectDiffuse = ( vec4( indirectDiffuse, 1.0 ) + vec4( 1.0, 1.0, 1.0, 0.0 ) ).xyz;
	ambientOcclusion = 1.0;
	indirectDiffuse = ( indirectDiffuse * vec3( ambientOcclusion ) );
	indirectDiffuse = ( indirectDiffuse * DiffuseColor.xyz );
	directDiffuse = vec3( 0.0, 0.0, 0.0 );
	totalDiffuse = ( directDiffuse + indirectDiffuse );
	directSpecular = vec3( 0.0, 0.0, 0.0 );
	indirectSpecular = vec3( 0.0, 0.0, 0.0 );
	totalSpecular = ( directSpecular + indirectSpecular );
	outgoingLight = ( totalDiffuse + totalSpecular );
	Output = max( vec4( outgoingLight, DiffuseColor.w ), 0.0 );
	nodeVar59 = vec4( mix( Output.xyz, nodeUniform24, smoothstep( nodeUniform25, nodeUniform26, ( - v_positionView.z ) ) ), Output.w );
	vec4 nodeConst30 = nodeVar59;
	Output = nodeConst30;

	// result
	fragColor = nodeConst30;

}

//----VERTEX----
#version 300 es

// Three.js r187 - Node System


// extensions


// precision

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp samplerCube;
precision highp sampler2DArray;

precision highp usampler2D;
precision highp usampler3D;
precision highp usamplerCube;
precision highp usampler2DArray;

precision highp isampler2D;
precision highp isampler3D;
precision highp isamplerCube;
precision highp isampler2DArray;

precision highp sampler2DShadow;
precision highp sampler2DArrayShadow;
precision highp samplerCubeShadow;


// structs





// uniforms

layout( std140 ) uniform object {
	vec3 nodeUniform0;
	vec3 nodeUniform1;
	float nodeUniform2;
	vec3 nodeUniform3;
	uint nodeUniform5;
	uint nodeUniform6;
	uint nodeUniform7;
	uint nodeUniform8;
	uint nodeUniform9;
	uint nodeUniform10;
	uint nodeUniform11;
	uint nodeUniform12;
	uint nodeUniform13;
	uint nodeUniform14;
	vec3 nodeUniform16;
	float nodeUniform17;
	mat3 nodeUniform21;
	mat4 nodeUniform27;
};

layout( std140 ) uniform render {
	mat4 cameraProjectionMatrix;
	mat4 cameraViewMatrix;
	vec3 nodeUniform19;
	vec3 nodeUniform23;
	vec3 nodeUniform18;
	vec3 nodeUniform24;
	float nodeUniform25;
	float nodeUniform26;
	vec2 nodeUniform15;
};


// varyings
vec3 positionLocal;
vec4 v_modelViewProjection;
out vec3 v_positionView;
out vec2 nodeVarying3;
flat  out vec4 nodeVarying4;
out vec4 nodeVarying5;
out vec3 nodeVarying6;
out vec3 v_normalViewGeometry;
vec4 VERTEX_v_modelViewProjection;


// attributes
layout( location = 0 ) in vec3 position;
layout( location = 1 ) in vec4 iA;
layout( location = 2 ) in vec4 iB;
layout( location = 3 ) in vec4 iC;
layout( location = 4 ) in vec4 iD;
layout( location = 5 ) in vec4 iUV;
layout( location = 6 ) in vec3 normal;


// vars
float nodeVar0;
vec3 normalLocal;
mat4 modelViewMatrix;

// codes


void main() {

	// transforms
	

	// flow
	// code

	positionLocal = position;

	if ( ( nodeUniform2 > 0.0 ) ) {

		vec3 nodeConst0 = ( iA.xyz - nodeUniform3 );
		float nodeConst1 = atan( ( - nodeConst0.y ), length( nodeConst0.xz ) );
		nodeVar0 = ( sign( nodeConst1 ) * max( 0.0, ( abs( nodeConst1 ) - nodeUniform2 ) ) );

	} else {

		nodeVar0 = 0.0;

	}

	vec3 nodeConst0 = ( iA.xyz - nodeUniform3 );
	positionLocal = ( ( ( ( iA.xyz + ( nodeUniform0 * vec3( ( ( ( ( ( ( position.xy.x + 0.5 ) * iB.x ) - iB.z ) / 16.0 ) * iA.w ) + iC.z ) ) ) ) + ( vec3( ( nodeUniform1.x * sin( nodeVar0 ) ), cos( nodeVar0 ), ( nodeUniform1.z * sin( nodeVar0 ) ) ) * vec3( ( ( ( ( ( ( ( position.xy.y * iB.y ) - ( iB.y - iB.w ) ) / 16.0 ) * iA.w ) * clamp( ( length( nodeConst0 ) / max( length( nodeConst0.xz ), 0.5 ) ), 1.0, 1.6 ) ) + iD.w ) - iD.w ) ) ) ) + vec3( 0.0, iD.w, 0.0 ) ) - ( nodeUniform1 * vec3( iC.w ) ) );
	vec2 nodeConst2 = vec2( mix( iUV.x, iUV.z, ( position.xy.x + 0.5 ) ), mix( iUV.w, iUV.y, position.xy.y ) );
	nodeVarying3 = nodeConst2;
	nodeVarying4 = iUV;
	nodeVarying5 = iC;
	nodeVarying6 = iD.xyz;
	normalLocal = normal;
	v_normalViewGeometry = normalize( ( cameraViewMatrix * vec4( ( nodeUniform21 * normalLocal ), 0.0 ) ).xyz );
	modelViewMatrix = ( cameraViewMatrix * nodeUniform27 );
	v_positionView = ( modelViewMatrix * vec4( positionLocal, 1.0 ) ).xyz;
	vec4 VERTEX_nodeConst31 = ( cameraProjectionMatrix * vec4( v_positionView, 1.0 ) );
	VERTEX_v_modelViewProjection = VERTEX_nodeConst31;

	// result
	gl_Position = VERTEX_v_modelViewProjection;

	gl_PointSize = 1.0;

}
